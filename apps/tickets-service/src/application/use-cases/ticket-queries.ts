import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import { TicketNotFoundError } from '../../domain/errors';
import {
  canView,
  type Ticket,
  type TicketComment,
  type TicketHistoryEntry,
  type TicketStatus,
} from '../../domain/ticket';
import type { TicketPage, TicketRepository } from '../ports/ticket.repository';

export interface TicketDetails {
  ticket: Ticket;
  /** Internal notes already filtered out for callers without note_internal. */
  comments: TicketComment[];
  history: TicketHistoryEntry[];
}

export class GetTicketUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(actor: Actor, ticketId: string): Promise<TicketDetails> {
    const ticket = await this.tickets.findById(
      requireOrganization(actor),
      ticketId,
    );
    // Non-owners get the same 404 as a missing ticket: a 403 would confirm
    // the ticket exists.
    if (!ticket || !canView(actor, ticket)) {
      throw new TicketNotFoundError();
    }

    // Internal notes (and the history entries that betray them) belong to
    // the internal staff workspace, which the note_internal grant delimits.
    const includeInternal = hasPermission(
      actor,
      PERMISSIONS.TICKETS_NOTE_INTERNAL,
    );
    const [comments, history] = await Promise.all([
      this.tickets.commentsFor(ticketId, includeInternal),
      this.tickets.historyFor(ticketId, includeInternal),
    ]);

    return { ticket, comments, history };
  }
}

export interface ListTicketsInput {
  status?: TicketStatus;
  /** Only honored for holders of the org-wide read: filter by assignee. */
  assigneeId?: string;
  skip?: number;
  take?: number;
}

const MAX_PAGE_SIZE = 100;

export class ListTicketsUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(actor: Actor, input: ListTicketsInput): Promise<TicketPage> {
    const organizationId = requireOrganization(actor);
    const take = Math.min(input.take ?? 20, MAX_PAGE_SIZE);
    const skip = Math.max(input.skip ?? 0, 0);

    // Without the org-wide read, callers are always scoped to their own
    // tickets, whatever they ask.
    if (!hasPermission(actor, PERMISSIONS.TICKETS_READ_ALL)) {
      return this.tickets.list({
        organizationId,
        requesterId: actor.id,
        status: input.status,
        skip,
        take,
      });
    }

    // read_all sees every ticket in the organization and nothing outside it.
    // Before this, the omitted scope widened the query to the whole table.
    return this.tickets.list({
      organizationId,
      status: input.status,
      assigneeId: input.assigneeId,
      skip,
      take,
    });
  }
}
