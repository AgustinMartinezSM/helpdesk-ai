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
  /**
   * Narrow to one branch. Honored organization-wide for read_all
   * (acceptance criterion 4); intersected with the caller's branch set for
   * read_branch — asking for a branch outside it answers the empty page.
   */
  branchId?: string;
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

    // read_all sees every ticket in the organization and nothing outside
    // it, optionally narrowed to one branch. Before the tenancy migration,
    // the omitted scope widened the query to the whole table.
    if (hasPermission(actor, PERMISSIONS.TICKETS_READ_ALL)) {
      return this.tickets.list({
        organizationId,
        status: input.status,
        assigneeId: input.assigneeId,
        branchId: input.branchId,
        skip,
        take,
      });
    }

    const branchIds = actor.branchIds;
    if (
      hasPermission(actor, PERMISSIONS.TICKETS_READ_BRANCH) &&
      branchIds !== undefined &&
      branchIds.size > 0
    ) {
      // A requested branch outside the caller's set answers the empty
      // page, never an error and never a widened query: a 4xx (or a page
      // of the caller's own tickets under that filter) would confirm the
      // branch exists — the same existence-hiding discipline as the 404 on
      // a foreign ticket.
      if (input.branchId !== undefined && !branchIds.has(input.branchId)) {
        return { items: [], total: 0 };
      }
      // The OR-own leg is the visibility rule, not a filter, so it
      // survives the branch narrowing: a manager's own requests are theirs
      // to see wherever they were filed. Branchless tickets fail the
      // IN-set leg by construction — unrouted intake belongs to the
      // central view until routing (9.11) exists.
      return this.tickets.list({
        organizationId,
        branchScope: {
          branchIds:
            input.branchId !== undefined ? [input.branchId] : [...branchIds],
          requesterId: actor.id,
        },
        status: input.status,
        skip,
        take,
      });
    }

    // Without the org-wide or branch read — including read_branch with an
    // empty or absent branch set, which denies rather than grants (D2) —
    // callers are scoped to their own tickets, whatever they ask.
    return this.tickets.list({
      organizationId,
      requesterId: actor.id,
      status: input.status,
      skip,
      take,
    });
  }
}
