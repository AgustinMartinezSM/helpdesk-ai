import type { Membership, MembershipStatus } from '../../domain/membership';

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');

export interface MembershipCreateResult {
  membership: Membership;
  /** True exactly when THIS call inserted the row. */
  created: boolean;
}

export interface MembershipRepository {
  findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null>;
  /** Every membership held by one person, oldest first. */
  listByUser(userId: string): Promise<Membership[]>;
  /**
   * Insert, or leave the existing row untouched and return it.
   *
   * "Leave untouched" is the important half. Delivery is at-least-once, so a
   * replayed user.registered.v1 must not reset a role template or a status
   * that someone has since changed, and must not bump the version other
   * services may be comparing against.
   *
   * The `created` flag says whether this call inserted the row, so the
   * caller can publish membership.created.v1 exactly once per row rather
   * than once per delivery.
   */
  createIfAbsent(membership: Membership): Promise<MembershipCreateResult>;
  /**
   * Sets the status, stamps `at` as updatedAt and bumps the version, in one
   * atomic update. The bump is what invalidates the `mv` claim in
   * outstanding tokens (ADR 0014), so it must not be able to miss a status
   * change under concurrency.
   */
  changeStatus(
    membershipId: string,
    to: MembershipStatus,
    at: Date,
  ): Promise<Membership>;
}
