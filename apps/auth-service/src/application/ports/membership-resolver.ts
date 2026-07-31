export const MEMBERSHIP_RESOLVER = Symbol('MEMBERSHIP_RESOLVER');

export interface ResolvedMembership {
  organizationId: string;
  permissions: string[];
  membershipVersion: number;
  /**
   * Branch ids the membership covers. Always present — an unscoped member
   * carries an empty array — because the internal contract answers the
   * question either way; whether the claim is minted is the session's call.
   */
  branchIds: string[];
}

/**
 * Answers which organization a user is acting in, at the moment a token is
 * being signed (ADR 0014). Resolution happens once per mint rather than per
 * request, which is what keeps the other services free of any synchronous
 * dependency on organizations-service.
 *
 * `null` means "this user belongs to no organization", which is a real and
 * expected answer during the migration: every user who registered before
 * organizations-service existed is in that state until the backfill runs.
 * It is not an error, and it must be distinguishable from one.
 */
export interface MembershipResolver {
  resolveFor(userId: string): Promise<ResolvedMembership | null>;
}

/** Structural subset of Nest's LoggerService; console satisfies it too. */
export interface SessionLogger {
  warn(message: string): void;
  error(message: string): void;
}
