export abstract class NotificationDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Covers both "does not exist" and "not yours" — existence never leaks. */
export class NotificationNotFoundError extends NotificationDomainError {
  constructor() {
    super('notification not found');
  }
}

/**
 * Raised when an event references a ticket this service has no ref for
 * (its ticket.created.v1 was lost or is still in flight). Deliberately
 * OUTSIDE the NotificationDomainError hierarchy: it must not map to an
 * HTTP response — it propagates out of the consumer handler so the
 * message dead-letters and stays replayable, instead of being silently
 * dropped (a swallowed gap here is a permanently lost notification).
 */
export class MissingTicketRefError extends Error {
  constructor(ticketId: string) {
    super(`no ticket ref for ${ticketId}; dead-lettering for replay`);
    this.name = 'MissingTicketRefError';
  }
}
