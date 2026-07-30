import type { Membership } from '../../domain/membership';

export const MEMBERSHIP_REPOSITORY = Symbol('MEMBERSHIP_REPOSITORY');

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
   */
  createIfAbsent(membership: Membership): Promise<Membership>;
}
