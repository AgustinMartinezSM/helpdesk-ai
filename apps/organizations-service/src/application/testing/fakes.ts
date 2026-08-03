import type {
  Branch,
  BranchMembership,
  Department,
  OperationalStation,
} from '../../domain/branch';
import {
  OWNER_ROLE_TEMPLATE,
  SUCCEEDED_OWNER_ROLE_TEMPLATE,
  type Membership,
  type MembershipStatus,
  type RoleTemplate,
} from '../../domain/membership';
import type { Invitation, InvitationStatus } from '../../domain/invitation';
import type { SupportTeam } from '../../domain/support-team';
import type {
  SupportTeamRepository,
  UpdateSupportTeamChanges,
} from '../ports/support-team.repository';
import type { Organization } from '../../domain/organization';
import { DuplicatePendingInvitationError } from '../../domain/errors';
import type {
  OrganizationEventPublisher,
  OwnershipTransfer,
  PeopleImportCompleted,
} from '../ports/event-publisher';
import type {
  InvitationListFilter,
  InvitationRepository,
  RedeemInvitationInput,
  RedeemInvitationResult,
} from '../ports/invitation.repository';
import type {
  MembershipCreateResult,
  MembershipRepository,
  TransferOwnershipInput,
  TransferredOwnership,
} from '../ports/membership.repository';
import type {
  Clock,
  IdGenerator,
  OrganizationRepository,
} from '../ports/organization.repository';
import type {
  BranchMembershipRepository,
  BranchRepository,
  DepartmentRepository,
  OperationalStationRepository,
  UpdateBranchChanges,
  UpdateDepartmentChanges,
  UpdateStationChanges,
} from '../ports/structure.repository';

/**
 * Deterministic in-memory test doubles for the application layer.
 *
 * The structure fakes enforce organization scope FOR REAL (R2's lesson): a
 * spec that hands them a foreign id gets the same null the database would
 * give, so a use case that forgot to scope a lookup fails its tests instead
 * of passing against a fake more permissive than production.
 */

export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly organizations = new Map<string, Organization>();

  add(organization: Organization): void {
    this.organizations.set(organization.id, organization);
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return (
      [...this.organizations.values()].find(
        (organization) => organization.slug === slug,
      ) ?? null
    );
  }

  async findById(id: string): Promise<Organization | null> {
    return this.organizations.get(id) ?? null;
  }

  /**
   * Honours the unique index FOR REAL, both of them: a duplicate slug and a
   * duplicate (organization, user) pair each throw, the way the database
   * would. A fake that accepted them would let a use case with a missing
   * uniqueness check pass its tests — the failure R2 recorded and 9.12
   * repeated with the team predicate.
   */
  async createWithOwner(
    organization: Organization,
    owner: Membership,
  ): Promise<{ organization: Organization; membership: Membership }> {
    if (await this.findBySlug(organization.slug)) {
      throw new Error(`duplicate slug: ${organization.slug}`);
    }
    const clash = this.memberships?.memberships.find(
      (existing) =>
        existing.organizationId === owner.organizationId &&
        existing.userId === owner.userId,
    );
    if (clash) {
      throw new Error('duplicate membership for (organization, user)');
    }
    this.organizations.set(organization.id, organization);
    this.memberships?.memberships.push(owner);
    return { organization, membership: owner };
  }

  async rename(
    organizationId: string,
    name: string,
    at: Date,
  ): Promise<Organization | null> {
    const existing = this.organizations.get(organizationId);
    if (!existing) {
      return null;
    }
    // Everything but the name and the timestamp is copied through, which is
    // the property the port promises: a fake that rebuilt the row would let a
    // repository that quietly recomputed the slug pass its tests.
    const renamed: Organization = { ...existing, name, updatedAt: at };
    this.organizations.set(organizationId, renamed);
    return renamed;
  }

  /**
   * The membership store this fake writes the owner row into. Set by a spec
   * that exercises creation; left undefined by the many specs that only read
   * organizations, so they do not have to know creation exists.
   */
  memberships?: InMemoryMembershipRepository;
}

export class InMemoryMembershipRepository implements MembershipRepository {
  readonly memberships: Membership[] = [];

  /**
   * The partial unique index, in memory: at most one `owner` row per
   * organization (Sprint 10.5's migration). Every write that could mint one
   * goes through it, so a future path that tries to produce a second owner
   * fails here instead of passing against a doll the database would refuse.
   */
  private refuseSecondOwner(membership: Membership, exceptId?: string): void {
    if (membership.roleTemplate !== OWNER_ROLE_TEMPLATE) {
      return;
    }
    const held = this.memberships.some(
      (existing) =>
        existing.organizationId === membership.organizationId &&
        existing.roleTemplate === OWNER_ROLE_TEMPLATE &&
        existing.id !== exceptId,
    );
    if (held) {
      throw new Error(
        `organization ${membership.organizationId} already has an owner`,
      );
    }
  }

  async findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null> {
    return (
      this.memberships.find(
        (membership) =>
          membership.organizationId === organizationId &&
          membership.userId === userId,
      ) ?? null
    );
  }

  async listByUser(userId: string): Promise<Membership[]> {
    return this.memberships
      .filter((membership) => membership.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createIfAbsent(
    membership: Membership,
  ): Promise<MembershipCreateResult> {
    const existing = await this.findByOrganizationAndUser(
      membership.organizationId,
      membership.userId,
    );
    if (existing) {
      return { membership: existing, created: false };
    }
    this.refuseSecondOwner(membership);
    this.memberships.push(membership);
    return { membership, created: true };
  }

  async changeStatus(
    membershipId: string,
    to: MembershipStatus,
    at: Date,
  ): Promise<Membership> {
    const index = this.memberships.findIndex(
      (membership) => membership.id === membershipId,
    );
    if (index < 0) {
      throw new Error(`no membership "${membershipId}" to change`);
    }
    const updated: Membership = {
      ...this.memberships[index],
      status: to,
      version: this.memberships[index].version + 1,
      updatedAt: at,
    };
    this.memberships[index] = updated;
    return updated;
  }

  async changeRoleTemplate(
    membershipId: string,
    to: RoleTemplate,
    at: Date,
  ): Promise<Membership> {
    const index = this.memberships.findIndex(
      (membership) => membership.id === membershipId,
    );
    if (index < 0) {
      throw new Error(`no membership "${membershipId}" to change`);
    }
    const updated: Membership = {
      ...this.memberships[index],
      roleTemplate: to,
      version: this.memberships[index].version + 1,
      updatedAt: at,
    };
    this.refuseSecondOwner(updated, updated.id);
    this.memberships[index] = updated;
    return updated;
  }

  async listByOrganizationAndIds(
    organizationId: string,
    membershipIds: string[],
  ): Promise<Membership[]> {
    return this.memberships.filter(
      (membership) =>
        membership.organizationId === organizationId &&
        membershipIds.includes(membership.id),
    );
  }

  async findByOrganizationAndId(
    organizationId: string,
    membershipId: string,
  ): Promise<Membership | null> {
    return (
      this.memberships.find(
        (membership) =>
          membership.id === membershipId &&
          membership.organizationId === organizationId,
      ) ?? null
    );
  }

  async findOwner(organizationId: string): Promise<Membership | null> {
    return (
      this.memberships.find(
        (membership) =>
          membership.organizationId === organizationId &&
          membership.roleTemplate === OWNER_ROLE_TEMPLATE,
      ) ?? null
    );
  }

  /**
   * Mirrors the SQL the Prisma adapter runs, not a convenient version of it —
   * the rule R2 recorded and 9.12 repeated. Both writes re-check the state the
   * caller decided against, and NEITHER lands unless both do, so a use case
   * that stopped checking the actor's template, or a repository that stopped
   * conditioning its updates, fails here rather than passing against a fake
   * more permissive than production.
   *
   * The demotion is applied to a copy and only committed at the end, which is
   * this store's version of "the transaction rolls back": an array does not
   * have one, and reverting by hand is how a half-transfer would sneak in.
   */
  async transferOwnership(
    input: TransferOwnershipInput,
  ): Promise<TransferredOwnership | null> {
    const fromIndex = this.memberships.findIndex(
      (membership) =>
        membership.id === input.fromMembershipId &&
        membership.organizationId === input.organizationId &&
        membership.roleTemplate === OWNER_ROLE_TEMPLATE,
    );
    if (fromIndex < 0) {
      return null;
    }
    const toIndex = this.memberships.findIndex(
      (membership) =>
        membership.id === input.toMembershipId &&
        membership.organizationId === input.organizationId &&
        membership.status === 'active' &&
        membership.roleTemplate !== OWNER_ROLE_TEMPLATE,
    );
    if (toIndex < 0) {
      return null;
    }

    const previousOwner: Membership = {
      ...this.memberships[fromIndex],
      roleTemplate: SUCCEEDED_OWNER_ROLE_TEMPLATE,
      version: this.memberships[fromIndex].version + 1,
      updatedAt: input.at,
    };
    const newOwner: Membership = {
      ...this.memberships[toIndex],
      roleTemplate: OWNER_ROLE_TEMPLATE,
      version: this.memberships[toIndex].version + 1,
      updatedAt: input.at,
    };
    this.memberships[fromIndex] = previousOwner;
    this.memberships[toIndex] = newOwner;
    return { previousOwner, newOwner };
  }
}

/**
 * Mirrors the SQL the Prisma adapter actually runs, not a convenient version
 * of it: `redeem` and `revoke` re-check the status inside the "update" the
 * way the conditional UPDATE does, so a use case that stopped guarding
 * against a second redemption fails here too. A fake that just did what it
 * was asked would let single-use silently break.
 */
export class InMemoryInvitationRepository implements InvitationRepository {
  readonly invitations: Invitation[] = [];

  async create(invitation: Invitation): Promise<Invitation> {
    const clashes = this.invitations.some(
      (existing) =>
        existing.organizationId === invitation.organizationId &&
        existing.inviteeEmail === invitation.inviteeEmail &&
        existing.status === 'pending',
    );
    // The partial unique index, in memory: only PENDING rows collide, so a
    // person who was invited and left can be invited again.
    if (clashes) {
      throw new DuplicatePendingInvitationError(invitation.organizationId);
    }
    this.invitations.push(invitation);
    return invitation;
  }

  async findById(invitationId: string): Promise<Invitation | null> {
    return (
      this.invitations.find((invitation) => invitation.id === invitationId) ??
      null
    );
  }

  async findStatusesByEmails(
    organizationId: string,
    emails: readonly string[],
  ): Promise<Map<string, 'pending' | 'accepted'>> {
    const wanted = new Set(emails);
    const statuses = new Map<string, 'pending' | 'accepted'>();
    for (const invitation of this.invitations) {
      if (
        invitation.organizationId !== organizationId ||
        !wanted.has(invitation.inviteeEmail) ||
        (invitation.status !== 'pending' && invitation.status !== 'accepted')
      ) {
        continue;
      }
      // accepted wins, as in the SQL: somebody re-invited after joining has
      // both rows, and being a member is the stronger fact.
      if (
        invitation.status === 'accepted' ||
        !statuses.has(invitation.inviteeEmail)
      ) {
        statuses.set(invitation.inviteeEmail, invitation.status);
      }
    }
    return statuses;
  }

  async findByOrganizationAndId(
    organizationId: string,
    invitationId: string,
  ): Promise<Invitation | null> {
    return (
      this.invitations.find(
        (invitation) =>
          invitation.id === invitationId &&
          invitation.organizationId === organizationId,
      ) ?? null
    );
  }

  async list(filter: InvitationListFilter): Promise<Invitation[]> {
    return this.invitations
      .filter(
        (invitation) =>
          invitation.organizationId === filter.organizationId &&
          (filter.status === undefined || invitation.status === filter.status),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(filter.offset, filter.offset + filter.limit);
  }

  async redeem(
    input: RedeemInvitationInput,
  ): Promise<RedeemInvitationResult | null> {
    const index = this.invitations.findIndex(
      (invitation) =>
        invitation.id === input.invitationId && invitation.status === 'pending',
    );
    if (index < 0) {
      return null;
    }
    const invitation: Invitation = {
      ...this.invitations[index],
      status: 'accepted' as InvitationStatus,
      acceptedByUserId: input.acceptedByUserId,
      acceptedAt: input.at,
      updatedAt: input.at,
    };
    this.invitations[index] = invitation;

    const existing = this.memberships?.find(
      (membership) =>
        membership.organizationId === input.membership.organizationId &&
        membership.userId === input.membership.userId,
    );
    if (existing) {
      return { invitation, membership: existing, membershipCreated: false };
    }
    this.memberships?.push(input.membership);
    return {
      invitation,
      membership: input.membership,
      membershipCreated: true,
    };
  }

  async revoke(
    organizationId: string,
    invitationId: string,
    revokedAt: Date,
  ): Promise<Invitation | null> {
    const index = this.invitations.findIndex(
      (invitation) =>
        invitation.id === invitationId &&
        invitation.organizationId === organizationId &&
        invitation.status === 'pending',
    );
    if (index < 0) {
      return null;
    }
    const invitation: Invitation = {
      ...this.invitations[index],
      status: 'revoked' as InvitationStatus,
      updatedAt: revokedAt,
    };
    this.invitations[index] = invitation;
    return invitation;
  }

  /**
   * The membership rows redemption writes into. Assigned by the spec from
   * the membership fake, because the real `redeem` writes both tables in one
   * transaction and a fake that kept its own copy would let a spec pass while
   * the two disagreed.
   */
  memberships?: Membership[];
}

export class InMemoryBranchRepository implements BranchRepository {
  readonly branches: Branch[] = [];

  async create(branch: Branch): Promise<Branch | null> {
    const taken = this.branches.some(
      (existing) =>
        existing.organizationId === branch.organizationId &&
        existing.code === branch.code,
    );
    if (taken) {
      return null;
    }
    this.branches.push(branch);
    return branch;
  }

  async findByOrganizationAndId(
    organizationId: string,
    branchId: string,
  ): Promise<Branch | null> {
    return (
      this.branches.find(
        (branch) =>
          branch.id === branchId && branch.organizationId === organizationId,
      ) ?? null
    );
  }

  async list(organizationId: string): Promise<Branch[]> {
    return this.branches
      .filter((branch) => branch.organizationId === organizationId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async update(
    branchId: string,
    changes: UpdateBranchChanges,
    at: Date,
  ): Promise<Branch> {
    const index = this.branches.findIndex((branch) => branch.id === branchId);
    if (index < 0) {
      throw new Error(`no branch "${branchId}" to update`);
    }
    const updated: Branch = {
      ...this.branches[index],
      ...changes,
      updatedAt: at,
    };
    this.branches[index] = updated;
    return updated;
  }
}

export class InMemoryDepartmentRepository implements DepartmentRepository {
  readonly departments: Department[] = [];

  async create(department: Department): Promise<Department | null> {
    const taken = this.departments.some(
      (existing) =>
        existing.branchId === department.branchId &&
        existing.name === department.name,
    );
    if (taken) {
      return null;
    }
    this.departments.push(department);
    return department;
  }

  async findByOrganizationAndId(
    organizationId: string,
    departmentId: string,
  ): Promise<Department | null> {
    return (
      this.departments.find(
        (department) =>
          department.id === departmentId &&
          department.organizationId === organizationId,
      ) ?? null
    );
  }

  async list(organizationId: string, branchId: string): Promise<Department[]> {
    return this.departments
      .filter(
        (department) =>
          department.branchId === branchId &&
          department.organizationId === organizationId,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async findByBranchAndName(
    branchId: string,
    name: string,
  ): Promise<Department | null> {
    return (
      this.departments.find(
        (department) =>
          department.branchId === branchId && department.name === name,
      ) ?? null
    );
  }

  async update(
    departmentId: string,
    changes: UpdateDepartmentChanges,
    at: Date,
  ): Promise<Department> {
    const index = this.departments.findIndex(
      (department) => department.id === departmentId,
    );
    if (index < 0) {
      throw new Error(`no department "${departmentId}" to update`);
    }
    const updated: Department = {
      ...this.departments[index],
      ...changes,
      updatedAt: at,
    };
    this.departments[index] = updated;
    return updated;
  }
}

export class InMemoryOperationalStationRepository implements OperationalStationRepository {
  readonly stations: OperationalStation[] = [];

  async create(
    station: OperationalStation,
  ): Promise<OperationalStation | null> {
    const taken = this.stations.some(
      (existing) =>
        existing.branchId === station.branchId &&
        existing.code === station.code,
    );
    if (taken) {
      return null;
    }
    this.stations.push(station);
    return station;
  }

  async findByOrganizationAndId(
    organizationId: string,
    stationId: string,
  ): Promise<OperationalStation | null> {
    return (
      this.stations.find(
        (station) =>
          station.id === stationId && station.organizationId === organizationId,
      ) ?? null
    );
  }

  async list(
    organizationId: string,
    branchId: string,
  ): Promise<OperationalStation[]> {
    return this.stations
      .filter(
        (station) =>
          station.branchId === branchId &&
          station.organizationId === organizationId,
      )
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async update(
    stationId: string,
    changes: UpdateStationChanges,
    at: Date,
  ): Promise<OperationalStation> {
    const index = this.stations.findIndex(
      (station) => station.id === stationId,
    );
    if (index < 0) {
      throw new Error(`no station "${stationId}" to update`);
    }
    const updated: OperationalStation = {
      ...this.stations[index],
      ...changes,
      updatedAt: at,
    };
    this.stations[index] = updated;
    return updated;
  }
}

export class InMemoryBranchMembershipRepository implements BranchMembershipRepository {
  readonly edges: BranchMembership[] = [];

  async assign(edge: BranchMembership): Promise<void> {
    const exists = this.edges.some(
      (existing) =>
        existing.membershipId === edge.membershipId &&
        existing.branchId === edge.branchId,
    );
    // Mirrors ON CONFLICT DO NOTHING: the existing edge keeps its createdAt.
    if (!exists) {
      this.edges.push(edge);
    }
  }

  async remove(membershipId: string, branchId: string): Promise<void> {
    const index = this.edges.findIndex(
      (edge) =>
        edge.membershipId === membershipId && edge.branchId === branchId,
    );
    if (index >= 0) {
      this.edges.splice(index, 1);
    }
  }

  async listBranchIds(membershipId: string): Promise<string[]> {
    return this.edges
      .filter((edge) => edge.membershipId === membershipId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((edge) => edge.branchId);
  }
}

export class FakeOrganizationEventPublisher implements OrganizationEventPublisher {
  readonly peopleImports: {
    summary: PeopleImportCompleted;
    correlationId?: string;
  }[] = [];
  readonly created: { membership: Membership; correlationId?: string }[] = [];
  readonly statusChanged: {
    membership: Membership;
    fromStatus: MembershipStatus;
    correlationId?: string;
  }[] = [];
  readonly roleChanged: {
    membership: Membership;
    fromTemplate: RoleTemplate;
    correlationId?: string;
  }[] = [];
  readonly branchesCreated: { branch: Branch; correlationId?: string }[] = [];
  readonly branchesUpdated: { branch: Branch; correlationId?: string }[] = [];
  readonly stationsCreated: {
    station: OperationalStation;
    correlationId?: string;
  }[] = [];
  readonly stationsUpdated: {
    station: OperationalStation;
    correlationId?: string;
  }[] = [];
  readonly teamsCreated: { team: SupportTeam; correlationId?: string }[] = [];
  readonly teamsUpdated: { team: SupportTeam; correlationId?: string }[] = [];
  readonly teamScopesChanged: {
    team: SupportTeam;
    branchIds: readonly string[];
    correlationId?: string;
  }[] = [];
  readonly invitationsIssued: {
    invitation: Invitation;
    correlationId?: string;
  }[] = [];
  readonly invitationsAccepted: {
    invitation: Invitation;
    acceptedByUserId: string;
    membershipId: string | undefined;
    correlationId?: string;
  }[] = [];
  readonly invitationsRevoked: {
    invitation: Invitation;
    revokedByUserId: string;
    correlationId?: string;
  }[] = [];
  readonly renamed: {
    organization: Organization;
    previousName: string;
    renamedByUserId: string;
    correlationId?: string;
  }[] = [];
  readonly ownershipTransfers: {
    transfer: OwnershipTransfer;
    correlationId?: string;
  }[] = [];

  async organizationRenamed(
    organization: Organization,
    previousName: string,
    renamedByUserId: string,
    correlationId?: string,
  ): Promise<void> {
    this.renamed.push({
      organization,
      previousName,
      renamedByUserId,
      correlationId,
    });
  }

  async organizationOwnershipTransferred(
    transfer: OwnershipTransfer,
    correlationId?: string,
  ): Promise<void> {
    this.ownershipTransfers.push({ transfer, correlationId });
  }

  async supportTeamCreated(
    team: SupportTeam,
    correlationId?: string,
  ): Promise<void> {
    this.teamsCreated.push({ team, correlationId });
  }

  async supportTeamUpdated(
    team: SupportTeam,
    correlationId?: string,
  ): Promise<void> {
    this.teamsUpdated.push({ team, correlationId });
  }

  async supportTeamScopeChanged(
    team: SupportTeam,
    branchIds: readonly string[],
    correlationId?: string,
  ): Promise<void> {
    this.teamScopesChanged.push({ team, branchIds, correlationId });
  }

  async membershipCreated(
    membership: Membership,
    correlationId?: string,
  ): Promise<void> {
    this.created.push({ membership, correlationId });
  }

  async membershipStatusChanged(
    membership: Membership,
    fromStatus: MembershipStatus,
    correlationId?: string,
  ): Promise<void> {
    this.statusChanged.push({ membership, fromStatus, correlationId });
  }

  async membershipRoleChanged(
    membership: Membership,
    fromTemplate: RoleTemplate,
    correlationId?: string,
  ): Promise<void> {
    this.roleChanged.push({ membership, fromTemplate, correlationId });
  }

  async branchCreated(branch: Branch, correlationId?: string): Promise<void> {
    this.branchesCreated.push({ branch, correlationId });
  }

  async branchUpdated(branch: Branch, correlationId?: string): Promise<void> {
    this.branchesUpdated.push({ branch, correlationId });
  }

  async stationCreated(
    station: OperationalStation,
    correlationId?: string,
  ): Promise<void> {
    this.stationsCreated.push({ station, correlationId });
  }

  async stationUpdated(
    station: OperationalStation,
    correlationId?: string,
  ): Promise<void> {
    this.stationsUpdated.push({ station, correlationId });
  }

  async invitationIssued(
    invitation: Invitation,
    correlationId?: string,
  ): Promise<void> {
    this.invitationsIssued.push({ invitation, correlationId });
  }

  async peopleImportCompleted(
    summary: PeopleImportCompleted,
    correlationId?: string,
  ): Promise<void> {
    this.peopleImports.push({ summary, correlationId });
  }

  async invitationAccepted(
    invitation: Invitation,
    acceptedByUserId: string,
    membershipId: string | undefined,
    correlationId?: string,
  ): Promise<void> {
    this.invitationsAccepted.push({
      invitation,
      acceptedByUserId,
      membershipId,
      correlationId,
    });
  }

  async invitationRevoked(
    invitation: Invitation,
    revokedByUserId: string,
    correlationId?: string,
  ): Promise<void> {
    this.invitationsRevoked.push({
      invitation,
      revokedByUserId,
      correlationId,
    });
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

/** Sequential ids, so a spec can name the row it expects. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = '00000000-0000-4000-8000-') {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}${String(this.counter).padStart(12, '0')}`;
  }
}

/**
 * Enforces the organization scope for real, like every other structure fake:
 * a spec that hands it a foreign team id gets the same null the database
 * would, so a use case that forgot to scope a lookup fails here rather than
 * passing against a doll more permissive than production.
 */
export class InMemorySupportTeamRepository implements SupportTeamRepository {
  readonly teams: SupportTeam[] = [];
  readonly members = new Map<string, string[]>();
  readonly scopes = new Map<string, string[]>();

  async create(team: SupportTeam): Promise<SupportTeam | null> {
    const taken = this.teams.some(
      (existing) =>
        existing.organizationId === team.organizationId &&
        existing.code === team.code,
    );
    if (taken) {
      return null;
    }
    this.teams.push(team);
    return team;
  }

  async findByOrganizationAndId(
    organizationId: string,
    teamId: string,
  ): Promise<SupportTeam | null> {
    return (
      this.teams.find(
        (team) => team.id === teamId && team.organizationId === organizationId,
      ) ?? null
    );
  }

  async list(organizationId: string): Promise<SupportTeam[]> {
    return this.teams
      .filter((team) => team.organizationId === organizationId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async update(
    teamId: string,
    changes: UpdateSupportTeamChanges,
    at: Date,
  ): Promise<SupportTeam> {
    const index = this.teams.findIndex((team) => team.id === teamId);
    if (index < 0) {
      throw new Error(`no support team "${teamId}" to update`);
    }
    const updated: SupportTeam = {
      ...this.teams[index],
      ...changes,
      updatedAt: at,
    };
    this.teams[index] = updated;
    return updated;
  }

  async setMembers(teamId: string, membershipIds: string[]): Promise<void> {
    this.members.set(teamId, [...membershipIds]);
  }

  async listMemberIds(teamId: string): Promise<string[]> {
    return this.members.get(teamId) ?? [];
  }

  async listActiveTeamIdsForMembership(
    membershipId: string,
  ): Promise<string[]> {
    // Archived teams are excluded here exactly as the SQL excludes them: this
    // read mints the claim that grants visibility.
    return this.teams
      .filter(
        (team) =>
          team.status === 'active' &&
          (this.members.get(team.id) ?? []).includes(membershipId),
      )
      .map((team) => team.id);
  }

  async setBranchScope(teamId: string, branchIds: string[]): Promise<void> {
    this.scopes.set(teamId, [...branchIds]);
  }

  async listBranchIds(teamId: string): Promise<string[]> {
    return this.scopes.get(teamId) ?? [];
  }
}
