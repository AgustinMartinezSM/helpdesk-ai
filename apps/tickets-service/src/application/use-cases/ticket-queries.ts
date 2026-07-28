import { TicketNotFoundError } from '../../domain/errors';
import {
  canView,
  isStaff,
  type Actor,
  type Ticket,
  type TicketComment,
  type TicketHistoryEntry,
  type TicketStatus,
} from '../../domain/ticket';
import type { TicketPage, TicketRepository } from '../ports/ticket.repository';

export interface TicketDetails {
  ticket: Ticket;
  /** Internal notes already filtered out for non-staff callers. */
  comments: TicketComment[];
  history: TicketHistoryEntry[];
}

export class GetTicketUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(actor: Actor, ticketId: string): Promise<TicketDetails> {
    const ticket = await this.tickets.findById(ticketId);
    // Non-owners get the same 404 as a missing ticket: a 403 would confirm
    // the ticket exists.
    if (!ticket || !canView(actor, ticket)) {
      throw new TicketNotFoundError();
    }

    const staff = isStaff(actor);
    const [comments, history] = await Promise.all([
      this.tickets.commentsFor(ticketId, staff),
      this.tickets.historyFor(ticketId),
    ]);

    return { ticket, comments, history };
  }
}

export interface ListTicketsInput {
  status?: TicketStatus;
  /** Staff only: filter by assignee. */
  assigneeId?: string;
  skip?: number;
  take?: number;
}

const MAX_PAGE_SIZE = 100;

export class ListTicketsUseCase {
  constructor(private readonly tickets: TicketRepository) {}

  async execute(actor: Actor, input: ListTicketsInput): Promise<TicketPage> {
    const take = Math.min(input.take ?? 20, MAX_PAGE_SIZE);
    const skip = Math.max(input.skip ?? 0, 0);

    // Requesters are always scoped to their own tickets, whatever they ask.
    if (!isStaff(actor)) {
      return this.tickets.list({
        requesterId: actor.id,
        status: input.status,
        skip,
        take,
      });
    }

    return this.tickets.list({
      status: input.status,
      assigneeId: input.assigneeId,
      skip,
      take,
    });
  }
}
