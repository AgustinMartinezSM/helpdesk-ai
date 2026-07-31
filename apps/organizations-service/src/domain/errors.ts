import type { MembershipStatus } from './membership';

export abstract class OrganizationDomainError extends Error {
  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Raised when an organization named by a caller does not exist. For the
 * bootstrap slug in the registration consumer this means the database was
 * provisioned wrong — the consumer lets it reject the message to the DLQ
 * instead of writing a membership pointing at nothing. On the internal HTTP
 * surface it is an ordinary 404: the caller named an organization this
 * database has never seen.
 */
export class OrganizationNotFoundError extends OrganizationDomainError {
  constructor(slugOrId: string) {
    super(`organization "${slugOrId}" not found`);
  }
}

export class MembershipNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, userId: string) {
    super(
      `user "${userId}" has no membership in organization "${organizationId}"`,
    );
  }

  /**
   * The same absence named by membership id — the shape station creation
   * validates a responsible manager with, where no userId is in hand.
   */
  static byId(
    organizationId: string,
    membershipId: string,
  ): MembershipNotFoundError {
    const error = new MembershipNotFoundError(organizationId, '');
    error.message = `membership "${membershipId}" not found in organization "${organizationId}"`;
    return error;
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

// ---------------------------------------------------------------------------
// Structure errors (branches, departments, stations — Sprint 9.5). The
// not-found errors deliberately say nothing about whether the id exists in
// another organization: a foreign row and a nonexistent one answer alike,
// because confirming existence is the leak.
// ---------------------------------------------------------------------------

export class BranchNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, branchId: string) {
    super(`branch "${branchId}" not found in organization "${organizationId}"`);
  }
}

export class DuplicateBranchCodeError extends OrganizationDomainError {
  constructor(organizationId: string, code: string) {
    super(
      `organization "${organizationId}" already has a branch with code "${code}"`,
    );
  }
}

export class DepartmentNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, departmentId: string) {
    super(
      `department "${departmentId}" not found in organization "${organizationId}"`,
    );
  }
}

export class DuplicateDepartmentNameError extends OrganizationDomainError {
  constructor(branchId: string, name: string) {
    super(`branch "${branchId}" already has a department named "${name}"`);
  }
}

export class StationNotFoundError extends OrganizationDomainError {
  constructor(organizationId: string, stationId: string) {
    super(
      `station "${stationId}" not found in organization "${organizationId}"`,
    );
  }
}

export class DuplicateStationCodeError extends OrganizationDomainError {
  constructor(branchId: string, code: string) {
    super(`branch "${branchId}" already has a station with code "${code}"`);
  }
}

/**
 * Raised when a role change names a template outside ROLE_TEMPLATES. The DTO
 * already refuses unknown words with a 400; this guards the use case for
 * callers that never went through HTTP validation.
 */
export class InvalidRoleTemplateError extends OrganizationDomainError {
  constructor(template: string) {
    super(`"${template}" is not a role template`);
  }
}

/**
 * Raised when a role change targets the template the membership already has
 * — the status transition table's no-self-loop argument, applied to roles:
 * an "already there" request means the caller acted on a stale picture of
 * the row, and confirming it with a success would keep it stale. Writing
 * anyway would bump the version and invalidate every outstanding token over
 * a non-change.
 */
export class SameRoleTemplateError extends OrganizationDomainError {
  constructor(template: string) {
    super(`membership already has the role template "${template}"`);
  }
}
