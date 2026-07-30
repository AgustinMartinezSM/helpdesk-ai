import type { SuggestionTask } from '../../domain/suggestion';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/**
 * Announces that a suggestion exists — identifiers and metadata only, never
 * content. Anything downstream that needs the text reads it from this
 * service's API with a token that authorizes it, exactly like the UI does.
 */
export interface SuggestionCreatedEvent {
  /** Trace id of the request that produced the suggestion, so an audit row
   * can be joined back to it. Never part of the payload. */
  readonly traceId?: string;
  /**
   * Tenant the requesting staff member belongs to, stamped on the v2
   * envelope. Optional because the token claim is: resolution fails open, so
   * a token minted during an organizations-service outage carries none. Its
   * absence skips the v2 copy rather than stopping the event.
   */
  readonly organizationId?: string;
  suggestionId: string;
  ticketId: string;
  task: SuggestionTask;
  provider: string;
  model: string;
  requestedBy: string;
  createdAt: Date;
}

/**
 * Best-effort by contract: the suggestion is already committed when this
 * runs, so a broker failure is logged and swallowed rather than failing a
 * request whose work is done (no outbox yet — ADR 0006).
 */
export interface EventPublisher {
  publishSuggestionCreated(event: SuggestionCreatedEvent): Promise<void>;
}
