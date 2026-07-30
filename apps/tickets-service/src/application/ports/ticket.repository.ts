import type {
  Ticket,
  TicketComment,
  TicketHistoryEntry,
  TicketStatus,
} from '../../domain/ticket';

export const TICKET_REPOSITORY = Symbol('TICKET_REPOSITORY');
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export interface TicketListFilter {
  requesterId?: string;
  assigneeId?: string;
  status?: TicketStatus;
  skip: number;
  take: number;
}

export interface TicketPage {
  items: Ticket[];
  total: number;
}

export interface TicketRepository {
  /** Persists the ticket together with its first history entry, atomically. */
  create(ticket: Ticket, history: TicketHistoryEntry): Promise<void>;
  findById(id: string): Promise<Ticket | null>;
  list(filter: TicketListFilter): Promise<TicketPage>;
  /** Persists mutated ticket fields and appends a history entry, atomically. */
  update(ticket: Ticket, history: TicketHistoryEntry): Promise<void>;
  addComment(
    comment: TicketComment,
    history: TicketHistoryEntry,
  ): Promise<void>;
  commentsFor(
    ticketId: string,
    includeInternal: boolean,
  ): Promise<TicketComment[]>;
  /**
   * `includeInternal` mirrors `commentsFor` and is required for the same
   * reason: an internal note writes a history entry of its own, so hiding
   * the note body while returning the entry still tells a requester that
   * staff wrote something private about their ticket, who wrote it and when.
   */
  historyFor(
    ticketId: string,
    includeInternal: boolean,
  ): Promise<TicketHistoryEntry[]>;
}
