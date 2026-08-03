import type {
  Membership,
  MembershipStatus,
  RoleTemplate,
} from '../../domain/membership';

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');

export interface MembershipCreateResult {
  membership: Membership;
  /** True exactly when THIS call inserted the row. */
  created: boolean;
}

export interface TransferOwnershipInput {
  organizationId: string;
  /** The membership currently carrying `owner`. */
  fromMembershipId: string;
  toMembershipId: string;
  at: Date;
}

export interface TransferredOwnership {
  /** The previous owner, now `organization_admin` and still a member. */
  previousOwner: Membership;
  newOwner: Membership;
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
  /**
   * Sets the role template with the same atomic version bump as
   * changeStatus, for the same reason: a role change rewrites what the
   * `perms` claim should say, so every outstanding token must become
   * detectably stale in the same statement that changes the row.
   */
  changeRoleTemplate(
    membershipId: string,
    to: RoleTemplate,
    at: Date,
  ): Promise<Membership>;
  /**
   * Lookup by membership id, scoped by organization at the port so a
   * foreign membership and a nonexistent one answer alike. Station creation
   * validates its responsible manager through this.
   */
  findByOrganizationAndId(
    organizationId: string,
    membershipId: string,
  ): Promise<Membership | null>;
  /**
   * Several memberships by id, scoped the same way. Exists so the station
   * listing can turn the `responsible_membership_id` column into the `userId`
   * the public surface speaks (Sprint 9.11, D3) in one query rather than one
   * per station.
   */
  listByOrganizationAndIds(
    organizationId: string,
    membershipIds: string[],
  ): Promise<Membership[]>;
  /**
   * The organization's owner, or null while it has none.
   *
   * Null is a real answer, not a fault: the bootstrap organization is seeded by
   * a migration with no owner at all, and every read here has to survive that.
   */
  findOwner(organizationId: string): Promise<Membership | null>;
  /**
   * Moves `owner` from one membership to another, atomically, or answers null
   * because somebody else moved it first (ADR 0024).
   *
   * Null rather than a thrown error, following `InvitationRepository.redeem`:
   * losing a race is an ordinary outcome this layer reports, and deciding what
   * it MEANS — a refusal telling the caller to re-read — belongs to the use
   * case. An implementation must make both writes conditional on the state
   * this call was decided against, and must leave the original ownership
   * untouched when either condition no longer holds.
   */
  transferOwnership(
    input: TransferOwnershipInput,
  ): Promise<TransferredOwnership | null>;
}
