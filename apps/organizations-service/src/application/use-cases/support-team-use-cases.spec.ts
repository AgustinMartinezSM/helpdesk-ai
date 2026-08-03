import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  DuplicateSupportTeamCodeError,
  ForbiddenTeamActionError,
  MembershipNotFoundError,
  SupportTeamNotFoundError,
} from '../../domain/errors';
import type { Membership, RoleTemplate } from '../../domain/membership';
import { permissionsForTemplate } from '../../domain/permissions';
import { canGrantRoleTemplate } from '../../domain/role-grants';
import {
  FakeOrganizationEventPublisher,
  FixedClock,
  InMemoryBranchRepository,
  InMemoryMembershipRepository,
  InMemorySupportTeamRepository,
  SequentialIdGenerator,
} from '../testing/fakes';
import {
  CreateSupportTeamUseCase,
  GetSupportTeamUseCase,
  ListMySupportTeamsUseCase,
  ListSupportTeamsUseCase,
  SetSupportTeamMembersUseCase,
  SetSupportTeamScopeUseCase,
  UpdateSupportTeamUseCase,
} from './support-teams';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000000ff';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';
const OUTSIDER_ID = '44444444-4444-4444-8444-444444444444';

function actorOf(
  template: RoleTemplate,
  userId: string,
  organizationId: string = ORG_ID,
): Actor {
  return {
    id: userId,
    organizationId,
    permissions: new Set(permissionsForTemplate(template)),
  };
}

function membership(
  id: string,
  userId: string,
  organizationId: string = ORG_ID,
): Membership {
  return {
    id,
    organizationId,
    userId,
    roleTemplate: 'agent',
    status: 'active',
    version: 1,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
  };
}

function buildContext() {
  const teams = new InMemorySupportTeamRepository();
  const memberships = new InMemoryMembershipRepository();
  const branches = new InMemoryBranchRepository();
  const clock = new FixedClock(new Date('2026-08-03T12:00:00.000Z'));
  const ids = new SequentialIdGenerator();
  const events = new FakeOrganizationEventPublisher();

  memberships.memberships.push(
    membership('m-admin', ADMIN_ID),
    membership('m-agent', AGENT_ID),
    membership('m-outsider', OUTSIDER_ID, OTHER_ORG_ID),
  );

  return {
    teams,
    memberships,
    branches,
    clock,
    events,
    create: new CreateSupportTeamUseCase(teams, clock, ids, events),
    update: new UpdateSupportTeamUseCase(teams, clock, events),
    list: new ListSupportTeamsUseCase(teams),
    mine: new ListMySupportTeamsUseCase(teams, memberships),
    get: new GetSupportTeamUseCase(teams, memberships),
    setMembers: new SetSupportTeamMembersUseCase(teams, memberships, clock),
    setScope: new SetSupportTeamScopeUseCase(teams, branches, clock, events),
  };
}

type Context = ReturnType<typeof buildContext>;

async function withTeam(ctx: Context, code = 'it', name = 'IT support') {
  return ctx.create.execute(actorOf('organization_admin', ADMIN_ID), {
    code,
    name,
  });
}

describe('support team administration', () => {
  it('creates a team that starts organization-wide', async () => {
    const ctx = buildContext();
    const team = await withTeam(ctx);

    expect(team.status).toBe('active');
    // The absence IS the reach: no scope rows means every branch (ADR 0022).
    expect(await ctx.teams.listBranchIds(team.id)).toEqual([]);
  });

  it('refuses a second team with the same code', async () => {
    const ctx = buildContext();
    await withTeam(ctx);

    await expect(withTeam(ctx, 'it', 'IT, again')).rejects.toBeInstanceOf(
      DuplicateSupportTeamCodeError,
    );
  });

  it('refuses every team action without teams.manage', async () => {
    const ctx = buildContext();
    const team = await withTeam(ctx);
    const agent = actorOf('agent', AGENT_ID);

    // The agent template deliberately holds tickets.read_team and no team
    // administration: seeing your team's work is not running it.
    expect(agent.permissions.has(PERMISSIONS.TICKETS_READ_TEAM)).toBe(true);
    expect(agent.permissions.has(PERMISSIONS.TEAMS_MANAGE)).toBe(false);

    await expect(ctx.list.execute(agent)).rejects.toBeInstanceOf(
      ForbiddenTeamActionError,
    );
    await expect(ctx.get.execute(agent, team.id)).rejects.toBeInstanceOf(
      ForbiddenTeamActionError,
    );
    await expect(
      ctx.update.execute(agent, { teamId: team.id, name: 'Renamed' }),
    ).rejects.toBeInstanceOf(ForbiddenTeamActionError);
    await expect(
      ctx.setMembers.execute(agent, { teamId: team.id, userIds: [AGENT_ID] }),
    ).rejects.toBeInstanceOf(ForbiddenTeamActionError);
    await expect(
      ctx.setScope.execute(agent, { teamId: team.id, branchIds: [] }),
    ).rejects.toBeInstanceOf(ForbiddenTeamActionError);
  });

  it('keeps archived teams in the administration listing', async () => {
    const ctx = buildContext();
    const admin = actorOf('organization_admin', ADMIN_ID);
    const team = await withTeam(ctx);
    await ctx.update.execute(admin, { teamId: team.id, status: 'archived' });

    // A screen that cannot see an archived team cannot reopen it.
    const listed = await ctx.list.execute(admin);
    expect(listed.map((entry) => entry.status)).toEqual(['archived']);
  });

  it('does not clear members or scope when a team is archived', async () => {
    const ctx = buildContext();
    const admin = actorOf('organization_admin', ADMIN_ID);
    const team = await withTeam(ctx);
    await ctx.setMembers.execute(admin, {
      teamId: team.id,
      userIds: [AGENT_ID],
    });

    await ctx.update.execute(admin, { teamId: team.id, status: 'archived' });

    // Reopening restores the group as it was — the no-cascade stance branches
    // took in Sprint 9.11.
    expect(await ctx.teams.listMemberIds(team.id)).toEqual(['m-agent']);
  });

  it("names members by userId and refuses another tenant's person", async () => {
    const ctx = buildContext();
    const admin = actorOf('organization_admin', ADMIN_ID);
    const team = await withTeam(ctx);

    await ctx.setMembers.execute(admin, {
      teamId: team.id,
      userIds: [AGENT_ID],
    });
    const detail = await ctx.get.execute(admin, team.id);
    expect(detail.memberUserIds).toEqual([AGENT_ID]);

    await expect(
      ctx.setMembers.execute(admin, {
        teamId: team.id,
        userIds: [OUTSIDER_ID],
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  it("cannot reach another organization's team", async () => {
    const ctx = buildContext();
    const team = await withTeam(ctx);
    const elsewhere = actorOf('organization_admin', ADMIN_ID, OTHER_ORG_ID);

    // A foreign team and a nonexistent one answer alike, which is what stops
    // this surface from confirming another tenant's ids.
    await expect(ctx.get.execute(elsewhere, team.id)).rejects.toBeInstanceOf(
      SupportTeamNotFoundError,
    );
    expect(await ctx.list.execute(elsewhere)).toEqual([]);
  });
});

describe('ListMySupportTeamsUseCase', () => {
  it('returns the teams the caller actively belongs to', async () => {
    const ctx = buildContext();
    const admin = actorOf('organization_admin', ADMIN_ID);
    const it = await withTeam(ctx);
    const payroll = await withTeam(ctx, 'payroll', 'Payroll');
    await ctx.setMembers.execute(admin, { teamId: it.id, userIds: [AGENT_ID] });

    const mine = await ctx.mine.execute(actorOf('agent', AGENT_ID));

    expect(mine.map((team) => team.id)).toEqual([it.id]);
    expect(mine.map((team) => team.name)).toEqual(['IT support']);
    expect(mine.map((team) => team.id)).not.toContain(payroll.id);
  });

  it('needs no team key: the agent template holds none', async () => {
    const ctx = buildContext();
    const admin = actorOf('organization_admin', ADMIN_ID);
    const team = await withTeam(ctx);
    await ctx.setMembers.execute(admin, {
      teamId: team.id,
      userIds: [AGENT_ID],
    });

    const agent = actorOf('agent', AGENT_ID);
    expect(agent.permissions.has(PERMISSIONS.TEAMS_MANAGE)).toBe(false);

    // It answers anyway, because it returns nothing the caller's own token
    // does not already carry in `tm`.
    await expect(ctx.mine.execute(agent)).resolves.toHaveLength(1);
  });

  it('excludes archived teams, exactly as the tm claim does', async () => {
    const ctx = buildContext();
    const admin = actorOf('organization_admin', ADMIN_ID);
    const team = await withTeam(ctx);
    await ctx.setMembers.execute(admin, {
      teamId: team.id,
      userIds: [AGENT_ID],
    });

    await ctx.update.execute(admin, { teamId: team.id, status: 'archived' });

    // The one asymmetry with `br`: a branch is a place and keeps its history,
    // a team is a working group and archiving one ends the visibility.
    expect(await ctx.mine.execute(actorOf('agent', AGENT_ID))).toEqual([]);
    expect(await ctx.teams.listActiveTeamIdsForMembership('m-agent')).toEqual(
      [],
    );
  });

  it('answers an empty list for somebody in no team', async () => {
    const ctx = buildContext();
    await withTeam(ctx);

    expect(await ctx.mine.execute(actorOf('agent', AGENT_ID))).toEqual([]);
  });

  it('answers an empty list when the caller has no membership yet', async () => {
    const ctx = buildContext();
    await withTeam(ctx);

    // Registration and membership are racy, and a token can legitimately name
    // an organization the caller's row has not landed in yet (ADR 0014).
    const stranger = actorOf(
      'requester',
      '55555555-5555-4555-8555-555555555555',
    );
    expect(await ctx.mine.execute(stranger)).toEqual([]);
  });

  it("never returns another organization's team", async () => {
    const ctx = buildContext();
    const admin = actorOf('organization_admin', ADMIN_ID);
    const team = await withTeam(ctx);
    await ctx.setMembers.execute(admin, {
      teamId: team.id,
      userIds: [AGENT_ID],
    });

    // Same user id, different tenant in the token: the membership lookup is
    // organization-scoped, so there is nobody to be a member as.
    const elsewhere = actorOf('agent', AGENT_ID, OTHER_ORG_ID);
    expect(await ctx.mine.execute(elsewhere)).toEqual([]);
  });
});

/**
 * Sprint 9.13, D4: the ticket routing picker reads the administration listing
 * (`GET /organizations/teams`) rather than a read endpoint of its own, which
 * is only sound while every template that can route can also list. That is a
 * premise, so it is pinned — the same discipline Sprint 9.8 used for
 * owner-resolves-like-organization_admin, so it speaks up when it stops being
 * true instead of leaving a picker that silently 403s.
 */
describe('routing.manage implies teams.manage (9.13 D4 premise)', () => {
  const templates: RoleTemplate[] = [
    'owner',
    'organization_admin',
    'branch_manager',
    'service_desk_manager',
    'team_manager',
    'agent',
    'requester',
    'auditor',
  ];

  it.each(templates)('holds for %s', (template) => {
    const permissions = permissionsForTemplate(template);
    if (permissions.has(PERMISSIONS.ROUTING_MANAGE)) {
      expect(permissions.has(PERMISSIONS.TEAMS_MANAGE)).toBe(true);
    }
  });

  it('is not vacuous — some template does hold routing.manage', () => {
    expect(
      templates.filter((template) =>
        permissionsForTemplate(template).has(PERMISSIONS.ROUTING_MANAGE),
      ),
    ).toEqual(['owner', 'organization_admin', 'service_desk_manager']);
  });
});

/**
 * Sprint 9.13, D2. Both grants exist because a screen needs them, so both get
 * a line here rather than living only in a comment.
 */
describe('the service desk manager can work the team editors (9.14 D4)', () => {
  it('reads branches, because a team’s reach is a set of them', () => {
    const permissions = permissionsForTemplate('service_desk_manager');
    expect(permissions.has(PERMISSIONS.TEAMS_MANAGE)).toBe(true);
    expect(permissions.has(PERMISSIONS.BRANCHES_READ)).toBe(true);
  });

  it('names candidates WITHOUT reading the directory (required case 2)', () => {
    const permissions = permissionsForTemplate('service_desk_manager');
    // The narrow key is what a member picker actually needs.
    expect(permissions.has(PERMISSIONS.PEOPLE_READ_ASSIGNABLE)).toBe(true);
    // And the flat directory key Sprint 9.13 granted as an interim widening
    // is gone. This assertion is that widening's obituary: if it ever comes
    // back, it comes back on purpose.
    expect(permissions.has(PERMISSIONS.PEOPLE_READ)).toBe(false);
  });

  it('still cannot administer people or branches', () => {
    const permissions = permissionsForTemplate('service_desk_manager');
    expect(permissions.has(PERMISSIONS.PEOPLE_ASSIGN_ROLES)).toBe(false);
    expect(permissions.has(PERMISSIONS.PEOPLE_SUSPEND)).toBe(false);
    expect(permissions.has(PERMISSIONS.PEOPLE_INVITE)).toBe(false);
    expect(permissions.has(PERMISSIONS.BRANCHES_CREATE)).toBe(false);
    expect(permissions.has(PERMISSIONS.BRANCHES_UPDATE)).toBe(false);
  });

  it('is still grantable by an admin, which the narrowing could have broken', () => {
    // The failure mode Sprint 9.10 hit with `tickets.read_branch`: give a
    // template a key the granter's own set does not literally contain, and
    // nobody can create that template through any surface. The implication
    // table is what keeps `people.read` counting as `people.read_assignable`.
    expect(
      canGrantRoleTemplate('organization_admin', 'service_desk_manager'),
    ).toBe(true);
    expect(canGrantRoleTemplate('owner', 'service_desk_manager')).toBe(true);
  });
});

/**
 * Required case 3: a team manager cannot browse people at all. They run a
 * team's workload; staffing it is the desk manager's act.
 */
describe('a team manager cannot browse people (required case 3)', () => {
  it('holds neither directory key, nor team administration', () => {
    const permissions = permissionsForTemplate('team_manager');
    expect(permissions.has(PERMISSIONS.PEOPLE_READ)).toBe(false);
    expect(permissions.has(PERMISSIONS.PEOPLE_READ_ASSIGNABLE)).toBe(false);
    expect(permissions.has(PERMISSIONS.TEAMS_MANAGE)).toBe(false);
  });

  it('and neither does an agent or a requester', () => {
    expect(
      permissionsForTemplate('agent').has(PERMISSIONS.PEOPLE_READ_ASSIGNABLE),
    ).toBe(false);
    expect(
      permissionsForTemplate('requester').has(PERMISSIONS.PEOPLE_READ),
    ).toBe(false);
  });
});
