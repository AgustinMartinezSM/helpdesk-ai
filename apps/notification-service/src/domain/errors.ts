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

/**
 * Raised when an event's organization does not match the tenant stored on
 * the ticket ref it references. Outside the NotificationDomainError
 * hierarchy for the same reason as MissingTicketRefError: it must never map
 * to an HTTP response — it propagates out of the consumer handler so the
 * delivery dead-letters. A mismatch means a forged or corrupted event, and
 * silently notifying would deliver one tenant's fact to another tenant's
 * user — the exact failure mode the tenancy migration exists to prevent.
 */
export class TenantMismatchError extends Error {
  constructor(ticketId: string, stored: string, received: string) {
    super(
      `event organization ${received} does not match organization ${stored} ` +
        `stored for ticket ${ticketId}; dead-lettering for inspection`,
    );
    this.name = 'TenantMismatchError';
  }
}
