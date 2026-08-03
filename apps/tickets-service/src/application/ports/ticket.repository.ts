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
  /**
   * Required, and first, on purpose.
   *
   * Every other field here is optional and the predicate is built from
   * optional spreads, so before this existed, omitting a filter widened the
   * query instead of narrowing it — `list({skip, take})` returned the whole
   * table. A required field cannot be omitted by accident: forgetting it is a
   * compile error, which is the only kind of reminder that survives a
   * refactor (R1).
   */
  organizationId: string;
  requesterId?: string;
  assigneeId?: string;
  status?: TicketStatus;
  /**
   * Exact branch narrowing for the org-wide read (acceptance criterion 4).
   * Never combined with branchScope: read_all narrows a set it already sees
   * in full, so no OR-leg is needed.
   */
  branchId?: string;
  /**
   * The branch-visibility predicate for `tickets.read_branch`: rows whose
   * branch is in `branchIds` OR whose requester is `requesterId`. One field
   * rather than two optionals, deliberately — the OR cannot be assembled at
   * a call site from halves, because either half alone silently means
   * something narrower (drop the caller's own tickets) or wider (every
   * branch plus own) than the visibility rule.
   */
  branchScope?: {
    branchIds: readonly string[];
    requesterId: string;
  };
  /** Exact team narrowing for the org-wide read, like branchId. */
  assignedTeamId?: string;
  /**
   * The team-visibility predicate for `tickets.read_team` (Sprint 9.12):
   * rows assigned to one of `teamIds` OR requested by `requesterId`. One
   * field for the same reason branchScope is one — either half alone means
   * something narrower or wider than the rule.
   */
  teamScope?: {
    teamIds: readonly string[];
    requesterId: string;
  };
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
  /**
   * The organization comes first because it is not a filter — it is the set
   * of rows this caller is allowed to address at all. A ticket from another
   * organization answers null, exactly as a missing one does: confirming it
   * exists would be the leak.
   */
  findById(organizationId: string, id: string): Promise<Ticket | null>;
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
