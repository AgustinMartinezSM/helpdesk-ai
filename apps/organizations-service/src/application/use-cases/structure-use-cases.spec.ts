import {
  BranchNotFoundError,
  DepartmentNotFoundError,
  DuplicateBranchCodeError,
  DuplicateDepartmentNameError,
  DuplicateStationCodeError,
  InvalidRoleTemplateError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
  SameRoleTemplateError,
  StationNotFoundError,
} from '../../domain/errors';
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
import { AssignBranchMembershipUseCase } from './assign-branch-membership';
import { ChangeMembershipRoleUseCase } from './change-membership-role';
import { CreateBranchUseCase } from './create-branch';
import { CreateDepartmentUseCase } from './create-department';
import { CreateStationUseCase } from './create-station';
import { EnsureMembershipUseCase } from './ensure-membership';
import { RemoveBranchMembershipUseCase } from './remove-branch-membership';
import { ResolveActiveMembershipUseCase } from './resolve-active-membership';
import { UpdateBranchUseCase } from './update-branch';
import { UpdateDepartmentUseCase } from './update-department';
import { UpdateStationUseCase } from './update-station';

const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000000ff';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

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
    assignBranchMembership: new AssignBranchMembershipUseCase(
      memberships,
      branches,
      branchMemberships,
      clock,
    ),
    removeBranchMembership: new RemoveBranchMembershipUseCase(
      memberships,
      branches,
      branchMemberships,
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
    const membership = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });
    const branch = await withBranch(ctx);
    await ctx.assignBranchMembership.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      branchId: branch.id,
    });
    return { membership, branch };
  }

  it('assigns idempotently: two PUTs are one edge', async () => {
    const ctx = buildContext();
    const { branch } = await withCoveredMembership(ctx);

    await ctx.assignBranchMembership.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      branchId: branch.id,
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
  });

  it('removes idempotently: deleting an absent edge succeeds', async () => {
    const ctx = buildContext();
    const { branch } = await withCoveredMembership(ctx);

    await ctx.removeBranchMembership.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      branchId: branch.id,
    });
    await expect(
      ctx.removeBranchMembership.execute({
        organizationId: BOOTSTRAP_ID,
        userId: USER_ID,
        branchId: branch.id,
      }),
    ).resolves.toBeUndefined();

    expect(ctx.branchMemberships.edges).toHaveLength(0);
    expect(
      (await ctx.resolveActiveMembership.execute(USER_ID))?.branchIds,
    ).toEqual([]);
  });

  it('refuses to bridge organizations', async () => {
    const ctx = buildContext();
    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });
    const foreignBranch = await withBranch(ctx, OTHER_ORG_ID);

    // A membership of org A covering a branch of org B would widen
    // someone's visibility across the tenant boundary.
    await expect(
      ctx.assignBranchMembership.execute({
        organizationId: BOOTSTRAP_ID,
        userId: USER_ID,
        branchId: foreignBranch.id,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundError);
    await expect(
      ctx.assignBranchMembership.execute({
        organizationId: OTHER_ORG_ID,
        userId: USER_ID,
        branchId: foreignBranch.id,
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
    expect(ctx.branchMemberships.edges).toHaveLength(0);
  });
});

describe('ChangeMembershipRoleUseCase', () => {
  async function contextWithRequester() {
    const ctx = buildContext();
    const membership = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });
    return { ...ctx, membership };
  }

  it('changes the template, bumps the version and publishes the move', async () => {
    const ctx = await contextWithRequester();
    ctx.clock.advanceSeconds(60);

    const updated = await ctx.changeMembershipRole.execute({
      organizationId: BOOTSTRAP_ID,
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

  it('reflects the new template in resolution', async () => {
    const ctx = await contextWithRequester();
    await ctx.changeMembershipRole.execute({
      organizationId: BOOTSTRAP_ID,
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
      ctx.changeMembershipRole.execute({
        organizationId: BOOTSTRAP_ID,
        userId: USER_ID,
        roleTemplate: 'requester',
      }),
    ).rejects.toBeInstanceOf(SameRoleTemplateError);
    expect(ctx.memberships.memberships[0].version).toBe(1);
    expect(ctx.events.roleChanged).toHaveLength(0);
  });

  it('refuses a word that is not a template', async () => {
    const ctx = await contextWithRequester();

    await expect(
      ctx.changeMembershipRole.execute({
        organizationId: BOOTSTRAP_ID,
        userId: USER_ID,
        roleTemplate: 'superuser',
      }),
    ).rejects.toBeInstanceOf(InvalidRoleTemplateError);
    expect(ctx.events.roleChanged).toHaveLength(0);
  });

  it('rejects a change for a user with no membership', async () => {
    const ctx = buildContext();

    await expect(
      ctx.changeMembershipRole.execute({
        organizationId: BOOTSTRAP_ID,
        userId: USER_ID,
        roleTemplate: 'agent',
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});
