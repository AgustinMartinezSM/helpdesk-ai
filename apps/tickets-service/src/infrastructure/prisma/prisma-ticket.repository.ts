import type {
  Ticket,
  TicketAction,
  TicketComment,
  TicketHistoryEntry,
  TicketPriority,
  TicketStatus,
} from '../../domain/ticket';
import { UntenantedRowError } from '../../domain/errors';
import type {
  TicketListFilter,
  TicketPage,
  TicketRepository,
} from '../../application/ports/ticket.repository';
import type { PrismaService } from './prisma.service';

interface TicketRow {
  id: string;
  /** Nullable in the column until the enforcement phase; see toDomain. */
  organizationId: string | null;
  title: string;
  description: string;
  status: string;
  priority: string;
  category: string | null;
  requesterId: string;
  assigneeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDomain(row: TicketRow): Ticket {
  return {
    ...row,
    organizationId: tenantOf(row.id, row.organizationId),
    status: row.status as TicketStatus,
    priority: row.priority as TicketPriority,
  };
}

/**
 * A row with no organization is a provisioning fault, not a request fault.
 *
 * The column is still nullable, so the type system cannot rule this out yet,
 * but nothing should produce one: the backfill filled every row that existed,
 * and the write paths have refused to create an untenanted one since. What is
 * left is a row written in the window between the two, and the fix is to
 * re-run the backfill — which is idempotent and which the enforcement phase
 * has to run anyway before it can add NOT NULL.
 *
 * Failing loudly beats defaulting. Guessing a tenant here would put somebody
 * else's row in front of a reader, which is the entire failure mode this
 * migration exists to prevent.
 */
function tenantOf(rowId: string, organizationId: string | null): string {
  if (!organizationId) {
    throw new UntenantedRowError(rowId);
  }
  return organizationId;
}

export class PrismaTicketRepository implements TicketRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(ticket: Ticket, history: TicketHistoryEntry): Promise<void> {
    // One transaction: a ticket without its 'created' history entry would
    // corrupt the audit trail.
    await this.prisma.$transaction([
      this.prisma.ticket.create({ data: { ...ticket } }),
      this.prisma.ticketHistoryEntry.create({ data: { ...history } }),
    ]);
  }

  async findById(organizationId: string, id: string): Promise<Ticket | null> {
    // findFirst, not findUnique: the organization is part of the predicate,
    // so a ticket belonging to someone else answers null rather than being
    // fetched and then judged. Nothing downstream can forget to judge it.
    const row = await this.prisma.ticket.findFirst({
      where: { id, organizationId },
    });
    return row ? toDomain(row) : null;
  }

  async list(filter: TicketListFilter): Promise<TicketPage> {
    const where = {
      // Not spread-optional like the rest: this one always narrows.
      organizationId: filter.organizationId,
      ...(filter.requesterId ? { requesterId: filter.requesterId } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items: rows.map(toDomain), total };
  }

  async update(ticket: Ticket, history: TicketHistoryEntry): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.ticket.update({
        where: { id: ticket.id },
        data: {
          status: ticket.status,
          priority: ticket.priority,
          assigneeId: ticket.assigneeId,
          updatedAt: ticket.updatedAt,
        },
      }),
      this.prisma.ticketHistoryEntry.create({ data: { ...history } }),
    ]);
  }

  async addComment(
    comment: TicketComment,
    history: TicketHistoryEntry,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.ticketComment.create({ data: { ...comment } }),
      this.prisma.ticketHistoryEntry.create({ data: { ...history } }),
    ]);
  }

  async commentsFor(
    ticketId: string,
    includeInternal: boolean,
  ): Promise<TicketComment[]> {
    const rows = await this.prisma.ticketComment.findMany({
      where: { ticketId, ...(includeInternal ? {} : { internal: false }) },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      ...row,
      organizationId: tenantOf(row.id, row.organizationId),
    }));
  }

  async historyFor(
    ticketId: string,
    includeInternal: boolean,
  ): Promise<TicketHistoryEntry[]> {
    const rows = await this.prisma.ticketHistoryEntry.findMany({
      where: {
        ticketId,
        // An internal note leaves a `comment_added` entry whose detail says
        // `internal`. Returning it to a requester discloses that a private
        // note exists, its author and its timestamp — everything except the
        // words. Excluded rather than redacted: a redacted row still says
        // something happened.
        ...(includeInternal
          ? {}
          : { NOT: { action: 'comment_added', detail: 'internal' } }),
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => ({
      ...row,
      organizationId: tenantOf(row.id, row.organizationId),
      action: row.action as TicketAction,
    }));
  }
}
