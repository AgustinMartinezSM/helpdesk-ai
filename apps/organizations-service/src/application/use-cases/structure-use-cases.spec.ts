import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  BranchNotFoundError,
  DepartmentNotFoundError,
  DuplicateBranchCodeError,
  DuplicateDepartmentNameError,
  DuplicateStationCodeError,
  ForbiddenMembershipActionError,
  InvalidRoleTemplateError,
  MembershipNotAdministrableError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  RoleTemplateNotGrantableError,
  SameRoleTemplateError,
  SelfMembershipAdministrationError,
  StationNotFoundError,
} from '../../domain/errors';
import { permissionsForTemplate } from '../../domain/permissions';
import type { Organization } from '../../domain/organization';
import {
  FakeOrganizationEventPublisher,
  FixedClock,
  InMemoryBranchMembershipRepository,
  InMemoryBranchRepository,
  InMemoryDepartmentRepository,
  InMemoryMembershipRepository,
  InMemoryOperationalStationRepository,
  InMemoryOrganizationRepository,
  SequentialIdGenerator,
} from '../testing/fakes';
import { ChangeMembershipRoleUseCase } from './change-membership-role';
import { CreateBranchUseCase } from './create-branch';
import { CreateDepartmentUseCase } from './create-department';
import { CreateStationUseCase } from './create-station';
import { EnsureMembershipUseCase } from './ensure-membership';
import {
  GetMembershipBranchesUseCase,
  ListBranchesUseCase,
  SetMembershipBranchesUseCase,
} from './membership-branches';
import { ResolveActiveMembershipUseCase } from './resolve-active-membership';
import { UpdateBranchUseCase } from './update-branch';
import { UpdateDepartmentUseCase } from './update-department';
import { UpdateStationUseCase } from './update-station';

const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000000ff';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '22222222-2222-4222-8222-222222222222';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

/** An administrator's token, matching the stored row the fixtures create. */
function admin(): Actor {
  return {
    id: ADMIN_ID,
    organizationId: BOOTSTRAP_ID,
    permissions: new Set(permissionsForTemplate('organization_admin')),
  };
}

function organization(overrides: Partial<Organization> = {}): Organization {
  return {
    id: BOOTSTRAP_ID,
    slug: 'bootstrap',
    name: 'Bootstrap organization',
    status: 'active',
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
    updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    ...overrides,
  };
}

function buildContext() {
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const branches = new InMemoryBranchRepository();
  const departments = new InMemoryDepartmentRepository();
  const stations = new InMemoryOperationalStationRepository();
  const branchMemberships = new InMemoryBranchMembershipRepository();
  const clock = new FixedClock(new Date('2026-07-31T12:00:00.000Z'));
  const ids = new SequentialIdGenerator();
  const events = new FakeOrganizationEventPublisher();

  organizations.add(organization());
  organizations.add(
    organization({ id: OTHER_ORG_ID, slug: 'other', name: 'Other' }),
  );

  return {
    organizations,
    memberships,
    branches,
    departments,
    stations,
    branchMemberships,
    clock,
    events,
    ensureMembership: new EnsureMembershipUseCase(
      organizations,
      memberships,
      clock,
      ids,
      events,
    ),
    createBranch: new CreateBranchUseCase(
      organizations,
      branches,
      clock,
      ids,
      events,
    ),
    updateBranch: new UpdateBranchUseCase(branches, clock, events),
    createDepartment: new CreateDepartmentUseCase(
      branches,
      departments,
      clock,
      ids,
    ),
    updateDepartment: new UpdateDepartmentUseCase(departments, clock),
    createStation: new CreateStationUseCase(
      branches,
      stations,
      memberships,
      clock,
      ids,
      events,
    ),
    updateStation: new UpdateStationUseCase(
      stations,
      memberships,
      clock,
      events,
    ),
    listBranches: new ListBranchesUseCase(branches),
    getMembershipBranches: new GetMembershipBranchesUseCase(
      memberships,
      branchMemberships,
    ),
    setMembershipBranches: new SetMembershipBranchesUseCase(
      memberships,
      branches,
      branchMemberships,
      clock,
    ),
    changeMembershipRole: new ChangeMembershipRoleUseCase(
      memberships,
      clock,
      events,
    ),
    resolveActiveMembership: new ResolveActiveMembershipUseCase(
      memberships,
      organizations,
      branchMemberships,
    ),
  };
}

type Context = ReturnType<typeof buildContext>;

async function withBranch(ctx: Context, organizationId = BOOTSTRAP_ID) {
  return ctx.createBranch.execute({
    organizationId,
    code: 'store-12',
    name: 'Store 12',
    timezone: 'America/Argentina/Buenos_Aires',
  });
}

describe('CreateBranchUseCase', () => {
  it('creates an active branch and publishes branch.created.v1 with the tenant', async () => {
    const ctx = buildContext();

    const branch = await withBranch(ctx);

    expect(branch.organizationId).toBe(BOOTSTRAP_ID);
    expect(branch.status).toBe('active');
    expect(branch.address).toBeNull();
    expect(ctx.events.branchesCreated).toHaveLength(1);
    // The tenant travels ON the branch the adapter stamps onto the
    // envelope — a branch without one cannot exist.
    expect(ctx.events.branchesCreated[0].branch.organizationId).toBe(
      BOOTSTRAP_ID,
    );
  });

  it('refuses a duplicate code within the organization', async () => {
    const ctx = buildContext();
    await withBranch(ctx);

    await expect(withBranch(ctx)).rejects.toBeInstanceOf(
      DuplicateBranchCodeError,
    );
    expect(ctx.branches.branches).toHaveLength(1);
    expect(ctx.events.branchesCreated).toHaveLength(1);
  });

  it('allows the same code in another organization', async () => {
    // Codes are unique per organization, never globally: every chain has a
    // "store-1".
    const ctx = buildContext();
    await withBranch(ctx);

    const other = await withBranch(ctx, OTHER_ORG_ID);
    expect(other.organizationId).toBe(OTHER_ORG_ID);
  });

  it('answers not-found for an organization this database has never seen', async () => {
    const ctx = buildContext();

    await expect(
      ctx.createBranch.execute({
        organizationId: UNKNOWN_ID,
        code: 'store-1',
        name: 'Store 1',
      }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    expect(ctx.events.branchesCreated).toHaveLength(0);
  });
});

describe('UpdateBranchUseCase', () => {
  it('archives a branch and publishes it as branch.updated.v1', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    ctx.clock.advanceSeconds(60);

    const archived = await ctx.updateBranch.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      status: 'archived',
    });

    // An archive IS an update: one contract, last-write state, no
    // lifecycle family of routing keys.
    expect(archived.status).toBe('archived');
    expect(ctx.events.branchesUpdated).toHaveLength(1);
    expect(ctx.events.branchesUpdated[0].branch.status).toBe('archived');
  });

  it('reverses an archive through the same update', async () => {
    // A place is not an access grant — unlike membership deactivation,
    // archived has a way back.
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    await ctx.updateBranch.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      status: 'archived',
    });

    const restored = await ctx.updateBranch.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      status: 'active',
    });
    expect(restored.status).toBe('active');
  });

  it('clears the timezone with an explicit null and keeps it when absent', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);

    const renamed = await ctx.updateBranch.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      name: 'Store 12 — North',
    });
    expect(renamed.timezone).toBe('America/Argentina/Buenos_Aires');

    const cleared = await ctx.updateBranch.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      timezone: null,
    });
    expect(cleared.timezone).toBeNull();
  });

  it.each([
    ['a foreign branch', OTHER_ORG_ID],
    ['an unknown branch', BOOTSTRAP_ID],
  ])('answers the same not-found for %s', async (_case, organizationId) => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    const branchId = organizationId === BOOTSTRAP_ID ? UNKNOWN_ID : branch.id;

    // A guessed id from another tenant and a nonexistent one must be
    // indistinguishable — confirming existence is the leak.
    await expect(
      ctx.updateBranch.execute({
        organizationId,
        branchId,
        name: 'Probe',
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundError);
    expect(ctx.events.branchesUpdated).toHaveLength(0);
  });
});

describe('department use cases', () => {
  it('creates a department under a branch and publishes nothing', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);

    const department = await ctx.createDepartment.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      name: 'Electronics',
    });

    expect(department.branchId).toBe(branch.id);
    expect(department.organizationId).toBe(BOOTSTRAP_ID);
    expect(department.status).toBe('active');
  });

  it('refuses a duplicate name within the branch', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    await ctx.createDepartment.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      name: 'Electronics',
    });

    await expect(
      ctx.createDepartment.execute({
        organizationId: BOOTSTRAP_ID,
        branchId: branch.id,
        name: 'Electronics',
      }),
    ).rejects.toBeInstanceOf(DuplicateDepartmentNameError);
  });

  it('refuses a rename onto a sibling department name', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    await ctx.createDepartment.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      name: 'Electronics',
    });
    const groceries = await ctx.createDepartment.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      name: 'Groceries',
    });

    await expect(
      ctx.updateDepartment.execute({
        organizationId: BOOTSTRAP_ID,
        departmentId: groceries.id,
        name: 'Electronics',
      }),
    ).rejects.toBeInstanceOf(DuplicateDepartmentNameError);
  });

  it('archives a department without an event', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    const department = await ctx.createDepartment.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      name: 'Electronics',
    });

    const archived = await ctx.updateDepartment.execute({
      organizationId: BOOTSTRAP_ID,
      departmentId: department.id,
      status: 'archived',
    });
    expect(archived.status).toBe('archived');
  });

  it('answers not-found for a department reached through the wrong organization', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    const department = await ctx.createDepartment.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      name: 'Electronics',
    });

    await expect(
      ctx.updateDepartment.execute({
        organizationId: OTHER_ORG_ID,
        departmentId: department.id,
        name: 'Probe',
      }),
    ).rejects.toBeInstanceOf(DepartmentNotFoundError);
  });

  it('answers not-found when creating under a foreign branch', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);

    await expect(
      ctx.createDepartment.execute({
        organizationId: OTHER_ORG_ID,
        branchId: branch.id,
        name: 'Electronics',
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundError);
  });
});

describe('station use cases', () => {
  async function withMembership(ctx: Context) {
    return ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });
  }

  it('creates an active station and publishes station.created.v1 with the tenant', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);

    const station = await ctx.createStation.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      code: 'cashier-2',
      name: 'Cashier station 2',
      area: 'checkout',
    });

    expect(station.branchId).toBe(branch.id);
    expect(station.organizationId).toBe(BOOTSTRAP_ID);
    expect(station.status).toBe('active');
    expect(station.responsibleMembershipId).toBeNull();
    expect(ctx.events.stationsCreated).toHaveLength(1);
    expect(ctx.events.stationsCreated[0].station.organizationId).toBe(
      BOOTSTRAP_ID,
    );
  });

  it('accepts a responsible membership of the same organization', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    const membership = await withMembership(ctx);

    const station = await ctx.createStation.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      code: 'cashier-2',
      name: 'Cashier station 2',
      responsibleMembershipId: membership.id,
    });
    expect(station.responsibleMembershipId).toBe(membership.id);
  });

  it('refuses a responsible membership from another organization', async () => {
    const ctx = buildContext();
    const membership = await withMembership(ctx);
    const foreignBranch = await withBranch(ctx, OTHER_ORG_ID);

    // The membership lives in bootstrap; the branch (and therefore the
    // station) lives in the other organization. A station must not point at
    // another tenant's people.
    await expect(
      ctx.createStation.execute({
        organizationId: OTHER_ORG_ID,
        branchId: foreignBranch.id,
        code: 'cashier-2',
        name: 'Cashier station 2',
        responsibleMembershipId: membership.id,
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
    expect(ctx.events.stationsCreated).toHaveLength(0);
  });

  it('refuses a duplicate code within the branch', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    await ctx.createStation.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      code: 'cashier-2',
      name: 'Cashier station 2',
    });

    await expect(
      ctx.createStation.execute({
        organizationId: BOOTSTRAP_ID,
        branchId: branch.id,
        code: 'cashier-2',
        name: 'Another till',
      }),
    ).rejects.toBeInstanceOf(DuplicateStationCodeError);
    expect(ctx.events.stationsCreated).toHaveLength(1);
  });

  it('updates a station and publishes station.updated.v1', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    const membership = await withMembership(ctx);
    const station = await ctx.createStation.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      code: 'cashier-2',
      name: 'Cashier station 2',
      responsibleMembershipId: membership.id,
    });
    ctx.clock.advanceSeconds(60);

    const updated = await ctx.updateStation.execute({
      organizationId: BOOTSTRAP_ID,
      stationId: station.id,
      status: 'archived',
      responsibleMembershipId: null,
    });

    expect(updated.status).toBe('archived');
    // null clears the column — a station may answer to nobody.
    expect(updated.responsibleMembershipId).toBeNull();
    expect(ctx.events.stationsUpdated).toHaveLength(1);
    expect(ctx.events.stationsUpdated[0].station.organizationId).toBe(
      BOOTSTRAP_ID,
    );
  });

  it('answers the same not-found for a foreign station as for an unknown one', async () => {
    const ctx = buildContext();
    const branch = await withBranch(ctx);
    const station = await ctx.createStation.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      code: 'cashier-2',
      name: 'Cashier station 2',
    });

    await expect(
      ctx.updateStation.execute({
        organizationId: OTHER_ORG_ID,
        stationId: station.id,
        name: 'Probe',
      }),
    ).rejects.toBeInstanceOf(StationNotFoundError);
    await expect(
      ctx.updateStation.execute({
        organizationId: BOOTSTRAP_ID,
        stationId: UNKNOWN_ID,
        name: 'Probe',
      }),
    ).rejects.toBeInstanceOf(StationNotFoundError);
    expect(ctx.events.stationsUpdated).toHaveLength(0);
  });
});

describe('branch membership use cases', () => {
  async function withCoveredMembership(ctx: Context) {
    await ctx.ensureMembership.execute({ userId: ADMIN_ID, roles: ['admin'] });
    const membership = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });
    const branch = await withBranch(ctx);
    await ctx.setMembershipBranches.execute(admin(), {
      userId: USER_ID,
      branchIds: [branch.id],
    });
    return { membership, branch };
  }

  it('converges: replacing with the same set is one edge', async () => {
    const ctx = buildContext();
    const { branch } = await withCoveredMembership(ctx);

    await ctx.setMembershipBranches.execute(admin(), {
      userId: USER_ID,
      branchIds: [branch.id],
    });

    expect(ctx.branchMemberships.edges).toHaveLength(1);
  });

  it('feeds the resolution branch set', async () => {
    const ctx = buildContext();
    const { branch } = await withCoveredMembership(ctx);

    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);
    expect(resolved?.branchIds).toEqual([branch.id]);
  });

  it('keeps an archived branch in the set', async () => {
    // A manager keeps seeing the history of a store that closed: archival
    // hides a branch from pickers, never from the people who covered it.
    const ctx = buildContext();
    const { branch } = await withCoveredMembership(ctx);
    await ctx.updateBranch.execute({
      organizationId: BOOTSTRAP_ID,
      branchId: branch.id,
      status: 'archived',
    });

    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);
    expect(resolved?.branchIds).toEqual([branch.id]);
    // And the listing still names it, or the editor above would silently
    // drop it the next time somebody saved.
    const listed = await ctx.listBranches.execute(admin());
    expect(listed.map((entry) => entry.id)).toContain(branch.id);
  });

  it('removes what the desired set leaves out', async () => {
    const ctx = buildContext();
    await withCoveredMembership(ctx);

    await ctx.setMembershipBranches.execute(admin(), {
      userId: USER_ID,
      branchIds: [],
    });

    expect(ctx.branchMemberships.edges).toHaveLength(0);
    expect(
      (await ctx.resolveActiveMembership.execute(USER_ID))?.branchIds,
    ).toEqual([]);
  });

  it('reads back the covered set', async () => {
    const ctx = buildContext();
    const { branch } = await withCoveredMembership(ctx);

    await expect(
      ctx.getMembershipBranches.execute(admin(), USER_ID),
    ).resolves.toEqual([branch.id]);
  });

  it('refuses to bridge organizations', async () => {
    const ctx = buildContext();
    await ctx.ensureMembership.execute({ userId: ADMIN_ID, roles: ['admin'] });
    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });
    const foreignBranch = await withBranch(ctx, OTHER_ORG_ID);

    // A membership of org A covering a branch of org B would widen
    // someone's visibility across the tenant boundary. The organization is
    // the ACTOR'S now, so there is no parameter left to get wrong.
    await expect(
      ctx.setMembershipBranches.execute(admin(), {
        userId: USER_ID,
        branchIds: [foreignBranch.id],
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundError);
    expect(ctx.branchMemberships.edges).toHaveLength(0);
  });

  it('validates every id before writing any edge', async () => {
    const ctx = buildContext();
    const { branch } = await withCoveredMembership(ctx);
    const foreignBranch = await withBranch(ctx, OTHER_ORG_ID);

    await expect(
      ctx.setMembershipBranches.execute(admin(), {
        userId: USER_ID,
        branchIds: [branch.id, foreignBranch.id],
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundError);
    // A partially applied replace would be worse than a refused one: the
    // caller asked for a set, not for whichever prefix happened to validate.
    expect(ctx.branchMemberships.edges).toHaveLength(1);
  });

  it('refuses a caller without branches.manage_members', async () => {
    const ctx = buildContext();
    const { branch } = await withCoveredMembership(ctx);

    await expect(
      ctx.setMembershipBranches.execute(
        { ...admin(), permissions: new Set([PERMISSIONS.BRANCHES_READ]) },
        { userId: USER_ID, branchIds: [branch.id] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenMembershipActionError);
  });

  it('refuses branch listing without branches.read', async () => {
    const ctx = buildContext();
    await withCoveredMembership(ctx);

    await expect(
      ctx.listBranches.execute({
        ...admin(),
        permissions: new Set([PERMISSIONS.PEOPLE_READ]),
      }),
    ).rejects.toBeInstanceOf(ForbiddenMembershipActionError);
  });

  it('lists only the caller organization branches', async () => {
    const ctx = buildContext();
    await withCoveredMembership(ctx);
    await withBranch(ctx, OTHER_ORG_ID);

    const listed = await ctx.listBranches.execute(admin());
    expect(listed).toHaveLength(1);
    expect(listed[0].organizationId).toBe(BOOTSTRAP_ID);
  });
});

describe('ChangeMembershipRoleUseCase', () => {
  async function contextWithRequester() {
    const ctx = buildContext();
    await ctx.ensureMembership.execute({ userId: ADMIN_ID, roles: ['admin'] });
    const membership = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });
    return { ...ctx, membership };
  }

  it('changes the template, bumps the version and publishes the move', async () => {
    const ctx = await contextWithRequester();
    ctx.clock.advanceSeconds(60);

    const updated = await ctx.changeMembershipRole.execute(admin(), {
      userId: USER_ID,
      roleTemplate: 'branch_manager',
      correlationId: 'req-789',
    });

    expect(updated.roleTemplate).toBe('branch_manager');
    // The bump is what invalidates the `perms` snapshot in outstanding
    // tokens — same mechanism as the status change (ADR 0014).
    expect(updated.version).toBe(2);

    expect(ctx.events.roleChanged).toHaveLength(1);
    const published = ctx.events.roleChanged[0];
    expect(published.membership).toEqual(updated);
    // PRE-change template as fromTemplate.
    expect(published.fromTemplate).toBe('requester');
    expect(published.correlationId).toBe('req-789');
  });

  it('lets an administrator create a branch manager (the 9.8 ceiling could not)', async () => {
    // The defect this sprint found: the ceiling compares permission sets, a
    // branch manager holds tickets.read_branch, and admins deliberately hold
    // tickets.read_all instead — so the subset test refused, and NOBODY could
    // create a branch manager through the product. The implication table is
    // what makes this pass.
    const ctx = await contextWithRequester();

    const updated = await ctx.changeMembershipRole.execute(admin(), {
      userId: USER_ID,
      roleTemplate: 'branch_manager',
    });

    expect(updated.roleTemplate).toBe('branch_manager');
  });

  it('reflects the new template in resolution', async () => {
    const ctx = await contextWithRequester();
    await ctx.changeMembershipRole.execute(admin(), {
      userId: USER_ID,
      roleTemplate: 'branch_manager',
    });

    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);
    expect(resolved?.permissions).toContain('tickets.read_branch');
    expect(resolved?.membershipVersion).toBe(2);
  });

  it('refuses the template the membership already has', async () => {
    const ctx = await contextWithRequester();

    // The status table's no-self-loop argument applied to roles: "already
    // there" is a stale caller, and a write would bump the version over a
    // non-change.
    await expect(
      ctx.changeMembershipRole.execute(admin(), {
        userId: USER_ID,
        roleTemplate: 'requester',
      }),
    ).rejects.toBeInstanceOf(SameRoleTemplateError);
    expect(ctx.memberships.memberships[1].version).toBe(1);
    expect(ctx.events.roleChanged).toHaveLength(0);
  });

  it.each(['superuser', 'owner'])('refuses the template %s', async (name) => {
    // Unknown words and `owner` answer alike, and owner is excluded by
    // constant rather than by the ceiling: it resolves to the same permission
    // set as organization_admin, so a subset test would wave it through.
    const ctx = await contextWithRequester();

    await expect(
      ctx.changeMembershipRole.execute(admin(), {
        userId: USER_ID,
        roleTemplate: name,
      }),
    ).rejects.toBeInstanceOf(InvalidRoleTemplateError);
    expect(ctx.events.roleChanged).toHaveLength(0);
  });

  it('rejects a change for a user with no membership', async () => {
    const ctx = await contextWithRequester();

    await expect(
      ctx.changeMembershipRole.execute(admin(), {
        userId: UNKNOWN_ID,
        roleTemplate: 'agent',
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });

  describe('administration boundaries (ADR 0021)', () => {
    it('refuses a caller without people.assign_roles', async () => {
      const ctx = await contextWithRequester();

      await expect(
        ctx.changeMembershipRole.execute(
          { ...admin(), permissions: new Set([PERMISSIONS.PEOPLE_SUSPEND]) },
          { userId: USER_ID, roleTemplate: 'agent' },
        ),
      ).rejects.toBeInstanceOf(ForbiddenMembershipActionError);
    });

    it('refuses re-roling yourself', async () => {
      // Self-demotion is the one mistake here with no undo: the key that
      // would reverse it is the key being given away.
      const ctx = await contextWithRequester();

      await expect(
        ctx.changeMembershipRole.execute(admin(), {
          userId: ADMIN_ID,
          roleTemplate: 'requester',
        }),
      ).rejects.toBeInstanceOf(SelfMembershipAdministrationError);
    });

    it('refuses a template the actor could not exercise themselves', async () => {
      const ctx = await contextWithRequester();
      ctx.memberships.memberships[0] = {
        ...ctx.memberships.memberships[0],
        roleTemplate: 'agent',
      };

      await expect(
        ctx.changeMembershipRole.execute(
          {
            ...admin(),
            permissions: new Set([
              ...permissionsForTemplate('agent'),
              PERMISSIONS.PEOPLE_ASSIGN_ROLES,
            ]),
          },
          { userId: USER_ID, roleTemplate: 'organization_admin' },
        ),
      ).rejects.toBeInstanceOf(RoleTemplateNotGrantableError);
      expect(ctx.events.roleChanged).toHaveLength(0);
    });

    it('refuses the owner as a target', async () => {
      const ctx = await contextWithRequester();
      ctx.memberships.memberships[1] = {
        ...ctx.memberships.memberships[1],
        roleTemplate: 'owner',
      };

      await expect(
        ctx.changeMembershipRole.execute(admin(), {
          userId: USER_ID,
          roleTemplate: 'requester',
        }),
      ).rejects.toBeInstanceOf(MembershipNotAdministrableError);
      expect(ctx.events.roleChanged).toHaveLength(0);
    });
  });
});
