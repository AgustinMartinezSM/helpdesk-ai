import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  BranchNotFoundError,
  DuplicateSupportTeamCodeError,
  ForbiddenTeamActionError,
  MembershipNotFoundError,
  SupportTeamNotFoundError,
} from '../../domain/errors';
import type { SupportTeam, SupportTeamStatus } from '../../domain/support-team';
import type { SupportTeamEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type { Clock, IdGenerator } from '../ports/organization.repository';
import type { BranchRepository } from '../ports/structure.repository';
import type { SupportTeamRepository } from '../ports/support-team.repository';

/**
 * Support teams: the groups that resolve tickets (ADR 0022).
 *
 * All of it is gated on `teams.manage`, including the listing. The matrix has
 * no separate read key for teams, and inventing one would be vocabulary
 * nobody approved — the listing exists to administer them, and the people who
 * need to SEE their team's work get that through `tickets.read_team` on the
 * tickets side rather than by reading this table.
 *
 * The organization always comes from the actor. There is no route and no
 * input anywhere below that names a tenant, which is what makes "organization
 * A cannot reference organization B's team" hold without each caller
 * remembering to check.
 */
function requireTeamAdministrator(actor: Actor): string {
  if (!hasPermission(actor, PERMISSIONS.TEAMS_MANAGE)) {
    throw new ForbiddenTeamActionError();
  }
  return requireOrganization(actor);
}

export interface CreateSupportTeamInput {
  code: string;
  name: string;
  correlationId?: string;
}

export class CreateSupportTeamUseCase {
  constructor(
    private readonly teams: SupportTeamRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: SupportTeamEventPublisher,
  ) {}

  /**
   * A team is born ORGANIZATION-WIDE: no scope rows, so it serves every
   * branch until somebody narrows it. That default is deliberate — the
   * central team is the common case, and a team created serving nothing would
   * be a trap where every assignment fails for a reason nobody can see.
   */
  async execute(
    actor: Actor,
    input: CreateSupportTeamInput,
  ): Promise<SupportTeam> {
    const organizationId = requireTeamAdministrator(actor);

    const now = this.clock.now();
    const created = await this.teams.create({
      id: this.ids.next(),
      organizationId,
      code: input.code,
      name: input.name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    if (!created) {
      throw new DuplicateSupportTeamCodeError(organizationId, input.code);
    }

    await this.events.supportTeamCreated(created, input.correlationId);
    return created;
  }
}

export interface UpdateSupportTeamInput {
  teamId: string;
  name?: string;
  status?: SupportTeamStatus;
  correlationId?: string;
}

export class UpdateSupportTeamUseCase {
  constructor(
    private readonly teams: SupportTeamRepository,
    private readonly clock: Clock,
    private readonly events: SupportTeamEventPublisher,
  ) {}

  /**
   * Renames or archives. The CODE is absent from the input, like a branch's
   * and for the same reason: it is the stable key other things refer to.
   *
   * Archiving does not clear the team's members or its scope, so reopening it
   * restores the group as it was — the same no-cascade stance Sprint 9.11
   * took for branches. What archiving DOES do is drop the team out of the
   * `tm` claim at the next mint, so its people stop seeing its tickets.
   */
  async execute(
    actor: Actor,
    input: UpdateSupportTeamInput,
  ): Promise<SupportTeam> {
    const organizationId = requireTeamAdministrator(actor);

    const team = await this.teams.findByOrganizationAndId(
      organizationId,
      input.teamId,
    );
    if (!team) {
      throw new SupportTeamNotFoundError(organizationId, input.teamId);
    }

    const updated = await this.teams.update(
      team.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      this.clock.now(),
    );

    await this.events.supportTeamUpdated(updated, input.correlationId);
    return updated;
  }
}

export class ListSupportTeamsUseCase {
  constructor(private readonly teams: SupportTeamRepository) {}

  /** Archived teams included: a screen that cannot see them cannot reopen. */
  async execute(actor: Actor): Promise<SupportTeam[]> {
    return this.teams.list(requireTeamAdministrator(actor));
  }
}

/**
 * The teams the caller themselves works in.
 *
 * NO PERMISSION KEY, and that is the decision rather than an omission. The
 * matrix has no read key for teams, `teams.manage` is for administering them,
 * and the people this exists for — a team manager, an agent, an auditor —
 * hold none of it. What they do hold is `tm`, a list of the very team ids this
 * returns: the token already carries the answer, and without this route the
 * only thing a screen can show for the team that owns a ticket is a UUID.
 *
 * Read through the SAME repository method the `tm` claim is minted from, so
 * the claim and the names can never disagree about which teams are archived.
 * Duplicating the filter here is how they would.
 */
export class ListMySupportTeamsUseCase {
  constructor(
    private readonly teams: SupportTeamRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async execute(actor: Actor): Promise<SupportTeam[]> {
    const organizationId = requireOrganization(actor);

    const membership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      actor.id,
    );
    // Nobody to be in a team as. An empty list, not a refusal: belonging to no
    // team is ordinary, and so is a token minted moments before the membership
    // it describes (ADR 0014).
    if (!membership) {
      return [];
    }

    const teamIds = await this.teams.listActiveTeamIdsForMembership(
      membership.id,
    );
    if (teamIds.length === 0) {
      return [];
    }

    // Re-read through the organization-scoped finder rather than trusting the
    // ids: every lookup on this port says whose team it is asking for, and
    // this one keeps that property instead of becoming the exception.
    const teams = await Promise.all(
      teamIds.map((teamId) =>
        this.teams.findByOrganizationAndId(organizationId, teamId),
      ),
    );
    return teams
      .filter((team): team is SupportTeam => team !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

export interface SupportTeamDetail {
  team: SupportTeam;
  /** User ids, not membership ids: the public surface speaks userId. */
  memberUserIds: string[];
  /** Empty means organization-wide. */
  branchIds: string[];
}

export class GetSupportTeamUseCase {
  constructor(
    private readonly teams: SupportTeamRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async execute(actor: Actor, teamId: string): Promise<SupportTeamDetail> {
    const organizationId = requireTeamAdministrator(actor);

    const team = await this.teams.findByOrganizationAndId(
      organizationId,
      teamId,
    );
    if (!team) {
      throw new SupportTeamNotFoundError(organizationId, teamId);
    }

    const [membershipIds, branchIds] = await Promise.all([
      this.teams.listMemberIds(team.id),
      this.teams.listBranchIds(team.id),
    ]);
    const members = await this.memberships.listByOrganizationAndIds(
      organizationId,
      membershipIds,
    );

    return {
      team,
      // Translated to userId in one query, the same shape the station's
      // responsible person uses (Sprint 9.11, D3).
      memberUserIds: members.map((membership) => membership.userId),
      branchIds,
    };
  }
}

export interface SetSupportTeamMembersInput {
  teamId: string;
  /** The full desired set, by userId. Anything absent is removed. */
  userIds: string[];
  correlationId?: string;
}

export class SetSupportTeamMembersUseCase {
  constructor(
    private readonly teams: SupportTeamRepository,
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * Replaces the team's people.
   *
   * Every user id is resolved against a membership of the ACTOR'S
   * organization, so a person from another tenant cannot be put in a team —
   * they answer the same not-found as a user id that never existed.
   *
   * No event: nothing outside this service consumes team membership. It
   * reaches tickets-service through the `tm` claim at mint time, which is the
   * mechanism `br` established, so a contract here would be a promise nobody
   * reads.
   */
  async execute(
    actor: Actor,
    input: SetSupportTeamMembersInput,
  ): Promise<string[]> {
    const organizationId = requireTeamAdministrator(actor);

    const team = await this.teams.findByOrganizationAndId(
      organizationId,
      input.teamId,
    );
    if (!team) {
      throw new SupportTeamNotFoundError(organizationId, input.teamId);
    }

    const desired = [...new Set(input.userIds)];
    const membershipIds: string[] = [];
    for (const userId of desired) {
      const membership = await this.memberships.findByOrganizationAndUser(
        organizationId,
        userId,
      );
      if (!membership) {
        throw new MembershipNotFoundError(organizationId, userId);
      }
      membershipIds.push(membership.id);
    }

    await this.teams.setMembers(team.id, membershipIds, this.clock.now());
    return desired;
  }
}

export interface SetSupportTeamScopeInput {
  teamId: string;
  /** The full desired set. EMPTY MEANS ORGANIZATION-WIDE, not "unchanged". */
  branchIds: string[];
  correlationId?: string;
}

export class SetSupportTeamScopeUseCase {
  constructor(
    private readonly teams: SupportTeamRepository,
    private readonly branches: BranchRepository,
    private readonly clock: Clock,
    private readonly events: SupportTeamEventPublisher,
  ) {}

  /**
   * Replaces the team's branch reach, and an empty array is the meaningful
   * organization-wide case rather than a no-op.
   *
   * Every branch is validated against the actor's organization before
   * anything is written, so a team cannot be pointed at another tenant's
   * store. This one DOES publish: tickets-service validates assignment
   * against the scope, so it has to know.
   */
  async execute(
    actor: Actor,
    input: SetSupportTeamScopeInput,
  ): Promise<string[]> {
    const organizationId = requireTeamAdministrator(actor);

    const team = await this.teams.findByOrganizationAndId(
      organizationId,
      input.teamId,
    );
    if (!team) {
      throw new SupportTeamNotFoundError(organizationId, input.teamId);
    }

    const desired = [...new Set(input.branchIds)];
    for (const branchId of desired) {
      const branch = await this.branches.findByOrganizationAndId(
        organizationId,
        branchId,
      );
      if (!branch) {
        throw new BranchNotFoundError(organizationId, branchId);
      }
    }

    await this.teams.setBranchScope(team.id, desired, this.clock.now());
    await this.events.supportTeamScopeChanged(
      team,
      desired,
      input.correlationId,
    );
    return desired;
  }
}
