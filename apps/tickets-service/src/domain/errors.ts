export abstract class TicketDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Also thrown when a non-staff caller targets someone else's ticket:
 * answering 403 would confirm the ticket exists, 404 does not.
 */
export class TicketNotFoundError extends TicketDomainError {
  constructor() {
    super('Ticket not found');
  }
}

export class ForbiddenTicketActionError extends TicketDomainError {
  constructor() {
    super('You are not allowed to perform this action on the ticket');
  }
}

export class InvalidStatusTransitionError extends TicketDomainError {
  constructor(from: string, to: string) {
    super(`A ticket cannot move from '${from}' to '${to}'`);
  }
}

/**
 * The caller's token carries no organization, so there is no tenant to write
 * the row under.
 *
 * Reachable in ordinary use, not just in a fault: it is the state of every
 * account between registering and organizations-service consuming the
 * registration event, which is normally milliseconds but is not guaranteed.
 * auth-service refuses to mint only when it *cannot determine* membership;
 * "this person belongs nowhere" is a real answer and still produces a token.
 *
 * So this is where that answer is enforced — at the write, where the
 * alternative is a row nobody can be shown to own.
 */
export class NoOrganizationContextError extends TicketDomainError {
  constructor() {
    super('Your account is not part of an organization yet');
  }
}

/**
 * A stored row carries no organization. The database was provisioned or
 * migrated incompletely — re-run the backfill — and until it is, the row
 * cannot be shown to anybody, because nothing can say whose it is.
 */
export class UntenantedRowError extends TicketDomainError {
  constructor(rowId: string) {
    super(`Row ${rowId} has no organization; re-run the tenant backfill`);
  }
}
