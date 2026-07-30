import type { TicketPriority, TicketStatus } from '../../domain/suggestion';

export const TICKET_SOURCE = Symbol('TICKET_SOURCE');

/** A ticket as tickets-service returns it, before this service reduces it
 * to the context a provider may see. */
export interface SourceTicket {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly category: string | null;
  readonly requesterId: string;
  readonly assigneeId: string | null;
}

export interface SourceComment {
  readonly authorId: string;
  readonly body: string;
  /** Staff-only note. Present in the response because the caller is staff;
   * dropped before any provider sees it (ADR 0011). */
  readonly internal: boolean;
  readonly createdAt: string;
}

export interface SourceTicketSnapshot {
  readonly ticket: SourceTicket;
  readonly comments: readonly SourceComment[];
}

/** Correlation headers to propagate so one user action stays one trace
 * across web -> bff -> gateway -> ai-service -> tickets-service. */
export type CorrelationHeaders = Readonly<Record<string, string>>;

/**
 * Reads one ticket from its owning service.
 *
 * `accessToken` is the CALLER's token, forwarded unchanged — this service
 * holds no credential of its own for the ticket store, so it can never read
 * a ticket the caller could not (ADR 0011).
 */
export interface TicketSource {
  fetch(
    ticketId: string,
    accessToken: string,
    correlation?: CorrelationHeaders,
  ): Promise<SourceTicketSnapshot>;
}
