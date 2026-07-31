import type { Branch, OperationalStation } from '../../domain/branch';
import type {
  Membership,
  MembershipStatus,
  RoleTemplate,
} from '../../domain/membership';

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
  /**
   * `membership` is the post-change row (template, bumped version);
   * `fromTemplate` is what it was before.
   */
  membershipRoleChanged(
    membership: Membership,
    fromTemplate: RoleTemplate,
    correlationId?: string,
  ): Promise<void>;
}

/**
 * Outbound structure events (branches and stations — Sprint 9.5, D4).
 * Everything the membership contract above says holds: best-effort after
 * the commit, born tenant-carrying, the row itself supplies the tenant.
 *
 * Departments publish nothing, on purpose: no consumer exists, and a
 * contract nobody reads is a promise nobody keeps.
 */
export interface StructureEventPublisher {
  branchCreated(branch: Branch, correlationId?: string): Promise<void>;
  /** The branch as it stands after the update — archive included. */
  branchUpdated(branch: Branch, correlationId?: string): Promise<void>;
  stationCreated(
    station: OperationalStation,
    correlationId?: string,
  ): Promise<void>;
  stationUpdated(
    station: OperationalStation,
    correlationId?: string,
  ): Promise<void>;
}

/** What the one wired publisher adapter provides under EVENT_PUBLISHER. */
export type OrganizationEventPublisher = MembershipEventPublisher &
  StructureEventPublisher;
