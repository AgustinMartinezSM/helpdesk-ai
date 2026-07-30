import { OrganizationNotFoundError } from '../../domain/errors';
import { roleTemplateFromGlobalRoles } from '../../domain/membership';
import type { Organization } from '../../domain/organization';
import {
  FixedClock,
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  SequentialIdGenerator,
} from '../testing/fakes';
import { EnsureMembershipUseCase } from './ensure-membership';
import { ResolveActiveMembershipUseCase } from './resolve-active-membership';

const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_ORG_ID = '00000000-0000-4000-8000-0000000000ff';
const USER_ID = '11111111-1111-4111-8111-111111111111';

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
  const clock = new FixedClock(new Date('2026-07-30T12:00:00.000Z'));
  const ensureMembership = new EnsureMembershipUseCase(
    organizations,
    memberships,
    clock,
    new SequentialIdGenerator(),
  );
  const resolveActiveMembership = new ResolveActiveMembershipUseCase(
    memberships,
    organizations,
  );
  return {
    organizations,
    memberships,
    clock,
    ensureMembership,
    resolveActiveMembership,
  };
}

describe('roleTemplateFromGlobalRoles', () => {
  it.each([
    [['user'], 'requester'],
    [['user', 'agent'], 'agent'],
    [['user', 'agent', 'admin'], 'organization_admin'],
    [['admin'], 'organization_admin'],
    [[], 'requester'],
  ])('maps %j to %s', (roles, expected) => {
    expect(roleTemplateFromGlobalRoles(roles)).toBe(expected);
  });

  it('prefers the most privileged role when several are present', () => {
    // admin wins over agent: the migration must not quietly demote anyone.
    expect(roleTemplateFromGlobalRoles(['agent', 'admin'])).toBe(
      'organization_admin',
    );
  });
});

describe('EnsureMembershipUseCase', () => {
  it('creates an active membership in the bootstrap organization', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());

    const membership = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user', 'agent'],
    });

    expect(membership.organizationId).toBe(BOOTSTRAP_ID);
    expect(membership.userId).toBe(USER_ID);
    expect(membership.roleTemplate).toBe('agent');
    expect(membership.status).toBe('active');
    expect(membership.version).toBe(1);
    expect(membership.createdAt).toEqual(new Date('2026-07-30T12:00:00.000Z'));
  });

  it('leaves an existing membership untouched on redelivery', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());

    const first = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });

    // Someone promotes the member after the first delivery.
    ctx.memberships.memberships[0] = {
      ...first,
      roleTemplate: 'organization_admin',
      version: 2,
    };
    ctx.clock.advanceSeconds(3600);

    // A replay of the same registration event must not undo that.
    const second = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });

    expect(ctx.memberships.memberships).toHaveLength(1);
    expect(second.roleTemplate).toBe('organization_admin');
    expect(second.version).toBe(2);
    expect(second.id).toBe(first.id);
  });

  it('refuses to write a membership when the bootstrap organization is absent', async () => {
    const ctx = buildContext();

    await expect(
      ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] }),
    ).rejects.toBeInstanceOf(OrganizationNotFoundError);
    expect(ctx.memberships.memberships).toHaveLength(0);
  });
});

describe('ResolveActiveMembershipUseCase', () => {
  it('resolves the organization and version for an active membership', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());
    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });

    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);

    expect(resolved).toEqual({
      organizationId: BOOTSTRAP_ID,
      permissions: [],
      membershipVersion: 1,
    });
  });

  it('returns null for a user with no membership', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());

    expect(await ctx.resolveActiveMembership.execute(USER_ID)).toBeNull();
  });

  it.each(['invited', 'suspended', 'deactivated'] as const)(
    'ignores a %s membership',
    async (status) => {
      const ctx = buildContext();
      ctx.organizations.add(organization());
      const membership = await ctx.ensureMembership.execute({
        userId: USER_ID,
        roles: ['user'],
      });
      ctx.memberships.memberships[0] = { ...membership, status };

      expect(await ctx.resolveActiveMembership.execute(USER_ID)).toBeNull();
    },
  );

  it('ignores an active membership in a suspended organization', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization({ status: 'suspended' }));
    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });

    expect(await ctx.resolveActiveMembership.execute(USER_ID)).toBeNull();
  });

  it('skips over a suspended membership to reach a usable one', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());
    ctx.organizations.add(
      organization({ id: OTHER_ORG_ID, slug: 'other', name: 'Other' }),
    );

    const suspended = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });
    ctx.memberships.memberships[0] = { ...suspended, status: 'suspended' };
    ctx.memberships.memberships.push({
      ...suspended,
      id: 'later-membership',
      organizationId: OTHER_ORG_ID,
      version: 7,
      createdAt: new Date('2026-07-30T13:00:00.000Z'),
    });

    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);

    expect(resolved?.organizationId).toBe(OTHER_ORG_ID);
    expect(resolved?.membershipVersion).toBe(7);
  });

  it('resolves the oldest active membership when a user belongs to several', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());
    ctx.organizations.add(
      organization({ id: OTHER_ORG_ID, slug: 'other', name: 'Other' }),
    );

    const first = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });
    ctx.memberships.memberships.push({
      ...first,
      id: 'later-membership',
      organizationId: OTHER_ORG_ID,
      createdAt: new Date('2026-07-30T13:00:00.000Z'),
    });

    // Deterministic until an organization selector exists; a login must not
    // land somewhere different depending on row order.
    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);
    expect(resolved?.organizationId).toBe(BOOTSTRAP_ID);
  });
});
