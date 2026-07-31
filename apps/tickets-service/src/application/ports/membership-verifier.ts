export const MEMBERSHIP_VERIFIER = Symbol('MEMBERSHIP_VERIFIER');

/** The standing organizations-service reports for one user in one tenant. */
export interface AssigneeMembership {
  status: string;
  roleTemplate: string;
  permissions: string[];
  organizationStatus: string;
}

/**
 * Answers what standing a would-be assignee has in an organization, at the
 * moment a ticket is being assigned to them.
 *
 * Validating an assignee needs membership data this service does not have.
 * A local projection would duplicate live access state and still be stale,
 * so assignment makes a synchronous internal call instead — accepted here
 * because assignment is a low-frequency, high-consequence mutation, exactly
 * the operation class ADR 0014 reserved re-validation for. This does NOT
 * open the door to read-path calls: reads keep resolving authorization from
 * the token alone.
 *
 * `null` means the user has no membership row in that organization — which
 * is also what a foreign user looks like from inside a tenant. It is a
 * definite answer, not a failure; adapters signal failure by throwing.
 */
export interface MembershipVerifier {
  findInOrganization(
    organizationId: string,
    userId: string,
  ): Promise<AssigneeMembership | null>;
}
