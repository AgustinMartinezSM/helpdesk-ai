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

/**
 * The chosen branch cannot receive tickets in this organization.
 *
 * One message for every cause — nonexistent, archived, another tenant's —
 * for the InvalidAssigneeError reason: branch ids are authorization inputs,
 * and confirming that a guessed id exists somewhere is the leak. A foreign
 * branch simply has no active row under the caller's organization in the
 * projection, so the cross-tenant case answers exactly like a typo.
 */
export class InvalidBranchError extends TicketDomainError {
  constructor() {
    super('The branch cannot receive tickets in this organization');
  }
}

/**
 * The chosen station cannot receive tickets under this branch.
 *
 * Same one-message discipline as InvalidBranchError, covering every cause:
 * an unknown or archived station, a station of another branch or another
 * tenant, and a station named without any branch at all — a station only
 * means something inside its branch (ADR 0016).
 */
export class InvalidStationError extends TicketDomainError {
  constructor() {
    super('The station cannot receive tickets under this branch');
  }
}

/**
 * The chosen support team cannot receive this ticket.
 *
 * Same one-message discipline as InvalidBranchError, covering every cause:
 * an unknown or archived team, a team of another organization, a team whose
 * branch reach excludes the ticket's branch, and a scoped team asked to take
 * a ticket that has no branch at all. Telling them apart would turn routing
 * into an oracle for another tenant's team ids.
 */
export class InvalidTeamContextError extends TicketDomainError {
  constructor() {
    super('The support team cannot receive this ticket');
  }
}

/**
 * The stations picker was asked about a branch that is not active in the
 * caller's organization. Also the answer for an archived or foreign branch:
 * the picker's 404 hides existence exactly as the ticket read's does.
 */
export class BranchNotFoundError extends TicketDomainError {
  constructor() {
    super('Branch not found');
  }
}
