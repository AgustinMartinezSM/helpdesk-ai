import type { MembershipStatus } from './membership';

export abstract class OrganizationDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Raised when the bootstrap organization is absent. It is created by the
 * initial migration, so this means the database was provisioned wrong rather
 * than that a request was wrong — the consumer lets it reject the message to
 * the DLQ instead of writing a membership pointing at nothing.
 */
export class OrganizationNotFoundError extends OrganizationDomainError {
  constructor(slug: string) {
    super(`organization "${slug}" not found`);
  }
}

export class MembershipNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, userId: string) {
    super(
      `user "${userId}" has no membership in organization "${organizationId}"`,
    );
  }
}

/**
 * Raised when a status change is not an edge of the transition table —
 * including a target equal to the current status: the table has no
 * self-loops, so "already there" is a stale caller, not a success.
 */
export class InvalidMembershipTransitionError extends OrganizationDomainError {
  constructor(from: MembershipStatus, to: MembershipStatus) {
    super(`membership status cannot change from "${from}" to "${to}"`);
  }
}
