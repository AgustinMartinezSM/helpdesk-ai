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
 * The chosen assignee cannot hold tickets in this organization.
 *
 * One message for every cause, on purpose. Distinguishing "no such user"
 * from "wrong organization", "suspended" or "not staff" would leak
 * membership facts across the internal boundary — probing assignment could
 * then map who belongs where. A foreign user simply has no membership row
 * under the ticket's organization, so the cross-tenant case answers exactly
 * like a guessed id.
 */
export class InvalidAssigneeError extends TicketDomainError {
  constructor() {
    super(
      'The assignee is not an active member who can hold tickets in this organization',
    );
  }
}

/**
 * The membership check could not run: the verifier is unconfigured, or the
 * call to organizations-service failed. Fail closed — refusing an
 * assignment is recoverable, a cross-tenant assignment is not.
 */
export class MembershipVerificationUnavailableError extends TicketDomainError {
  constructor() {
    super('Assignment is temporarily unavailable; try again shortly');
  }
}
