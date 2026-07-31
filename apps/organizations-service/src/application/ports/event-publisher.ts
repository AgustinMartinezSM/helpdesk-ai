import type { Membership, MembershipStatus } from '../../domain/membership';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/**
 * Outbound membership events. Publishing is best-effort by contract:
 * adapters must never let a broker failure break the write that already
 * committed (there is no outbox yet — see ADR 0006).
 *
 * No organizationId parameter, deliberately: the membership itself carries
 * its organization, and these events are born tenant-carrying — unlike the
 * ticket v2 dual-publish there is no "caller without a tenant" case to
 * tolerate, so the adapter stamps the envelope unconditionally.
 */
export interface MembershipEventPublisher {
  /** The membership as inserted. */
  membershipCreated(
    membership: Membership,
    correlationId?: string,
  ): Promise<void>;
  /**
   * `membership` is the post-transition row (status, bumped version);
   * `fromStatus` is what it was before.
   */
  membershipStatusChanged(
    membership: Membership,
    fromStatus: MembershipStatus,
    correlationId?: string,
  ): Promise<void>;
}
