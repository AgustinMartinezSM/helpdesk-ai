import type { Branch, OperationalStation } from '../../domain/branch';
import type { SupportTeam } from '../../domain/support-team';
import type { Invitation } from '../../domain/invitation';
import type { Organization } from '../../domain/organization';
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
 * What a completed ownership transfer records. Ids and templates only — the
 * payload names WHO, never anything about them, for the reason every event in
 * this service follows: audit keeps payloads opaquely and indefinitely.
 */
export interface OwnershipTransfer {
  organizationId: string;
  /** The person who initiated it, which is by rule the previous owner. */
  transferredByUserId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
  /** What the new owner's membership carried a moment earlier. */
  newOwnerPreviousRoleTemplate: RoleTemplate;
  at: Date;
}

/**
 * Outbound events about the organization itself (Sprint 10.5, ADR 0024).
 *
 * Their only consumer is the audit trail, and that is enough of one — the same
 * standing `people.import.completed.v1` has. What would not be enough is
 * publishing them because the other operations publish something: each of these
 * records an act the role-changed events cannot express, because those name
 * the row that moved and never the person who moved it.
 */
export interface OrganizationIdentityEventPublisher {
  organizationRenamed(
    organization: Organization,
    previousName: string,
    renamedByUserId: string,
    correlationId?: string,
  ): Promise<void>;
  organizationOwnershipTransferred(
    transfer: OwnershipTransfer,
    correlationId?: string,
  ): Promise<void>;
}

/**
 * Outbound structure events (branches and stations — Sprint 9.5, D4).
 * Everything the membership contract above says holds: best-effort after
 * the commit, born tenant-carrying, the row itself supplies the tenant.
 *
 * Departments publish nothing, on purpose: no consumer exists, and a
 * contract nobody reads is a promise nobody keeps. Routing did not change
 * that — it keys on support teams, which are a different concept
 * (ADR 0022).
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

/**
 * Support team events (Sprint 9.12, ADR 0022). Best-effort after the commit,
 * born tenant-carrying.
 *
 * Team MEMBERSHIP publishes nothing: it reaches tickets-service through the
 * `tm` claim at mint time, the mechanism `br` established, so a contract for
 * it would be a promise nobody reads. The branch SCOPE does publish, because
 * tickets-service validates assignment against it and therefore has to know.
 */
export interface SupportTeamEventPublisher {
  supportTeamCreated(team: SupportTeam, correlationId?: string): Promise<void>;
  /** The team as it stands after the update — archive included. */
  supportTeamUpdated(team: SupportTeam, correlationId?: string): Promise<void>;
  /** The WHOLE desired branch set; empty means organization-wide. */
  supportTeamScopeChanged(
    team: SupportTeam,
    branchIds: readonly string[],
    correlationId?: string,
  ): Promise<void>;
}

/**
 * Outbound invitation events (Sprint 9.8). Best-effort after the commit and
 * born tenant-carrying like the rest.
 *
 * Every method takes the acting person's id: attribution is the point of
 * these events, and the invitation row only records who issued it. The
 * payloads never carry the code, its hash, or the invited address — the
 * reasoning is in the contract definitions.
 */
export interface InvitationEventPublisher {
  invitationIssued(
    invitation: Invitation,
    correlationId?: string,
  ): Promise<void>;
  /**
   * `acceptedByUserId` is passed rather than read off the row: the domain
   * type makes it nullable (a pending invitation has none), and an adapter
   * coercing a null into the payload would publish an event that fails its
   * own schema at the broker.
   *
   * `membershipId` is present only when this redemption actually inserted a
   * membership: someone who already belonged consumes their invitation
   * without a new row, and naming one that does not exist would mislead
   * every consumer that projects it.
   */
  invitationAccepted(
    invitation: Invitation,
    acceptedByUserId: string,
    membershipId: string | undefined,
    correlationId?: string,
  ): Promise<void>;
  invitationRevoked(
    invitation: Invitation,
    revokedByUserId: string,
    correlationId?: string,
  ): Promise<void>;
}

/**
 * A bulk import finished. Counts only — the invitations it created published
 * themselves, and copying a few hundred addresses in here would duplicate
 * personal data into the audit store to answer a question already answered.
 */
export interface PeopleImportCompleted {
  organizationId: string;
  importedByUserId: string;
  total: number;
  invited: number;
  skipped: number;
  failed: number;
  at: Date;
}

export interface PeopleImportEventPublisher {
  peopleImportCompleted(
    summary: PeopleImportCompleted,
    correlationId?: string,
  ): Promise<void>;
}

/** What the one wired publisher adapter provides under EVENT_PUBLISHER. */
export type OrganizationEventPublisher = MembershipEventPublisher &
  OrganizationIdentityEventPublisher &
  StructureEventPublisher &
  SupportTeamEventPublisher &
  InvitationEventPublisher &
  PeopleImportEventPublisher;
