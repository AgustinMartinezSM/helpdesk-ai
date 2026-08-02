import { PERMISSIONS } from '@helpdesk-ai/security';
import {
  InvalidMembershipTransitionError,
  MembershipNotFoundError,
  OrganizationNotFoundError,
} from '../../domain/errors';
import {
  canTransitionMembershipStatus,
  MEMBERSHIP_STATUSES,
  ROLE_TEMPLATES,
  roleTemplateFromGlobalRoles,
  type MembershipStatus,
} from '../../domain/membership';
import { permissionsForTemplate } from '../../domain/permissions';
import type { Organization } from '../../domain/organization';
import {
  FakeOrganizationEventPublisher,
  FixedClock,
  InMemoryBranchMembershipRepository,
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  SequentialIdGenerator,
} from '../testing/fakes';
import { ChangeMembershipStatusUseCase } from './change-membership-status';
import { EnsureMembershipUseCase } from './ensure-membership';
import { GetMembershipUseCase } from './get-membership';
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
  const branchMemberships = new InMemoryBranchMembershipRepository();
  const clock = new FixedClock(new Date('2026-07-30T12:00:00.000Z'));
  const events = new FakeOrganizationEventPublisher();
  const ensureMembership = new EnsureMembershipUseCase(
    organizations,
    memberships,
    clock,
    new SequentialIdGenerator(),
    events,
  );
  const changeMembershipStatus = new ChangeMembershipStatusUseCase(
    memberships,
    clock,
    events,
  );
  const getMembership = new GetMembershipUseCase(
    memberships,
    organizations,
    branchMemberships,
  );
  const resolveActiveMembership = new ResolveActiveMembershipUseCase(
    memberships,
    organizations,
    branchMemberships,
  );
  return {
    organizations,
    memberships,
    branchMemberships,
    clock,
    events,
    ensureMembership,
    changeMembershipStatus,
    getMembership,
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

describe('canTransitionMembershipStatus', () => {
  it.each([
    ['invited', 'active'],
    ['invited', 'deactivated'],
    ['active', 'suspended'],
    ['active', 'deactivated'],
    ['suspended', 'active'],
    ['suspended', 'deactivated'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionMembershipStatus(from, to)).toBe(true);
  });

  it.each([
    ['active', 'invited'],
    ['suspended', 'invited'],
    ['invited', 'suspended'],
  ] as const)('refuses %s -> %s', (from, to) => {
    expect(canTransitionMembershipStatus(from, to)).toBe(false);
  });

  it.each(MEMBERSHIP_STATUSES)('refuses deactivated -> %s', (to) => {
    // Terminal on purpose: reactivation policy is a product decision
    // deferred to the people-management sprint.
    expect(canTransitionMembershipStatus('deactivated', to)).toBe(false);
  });

  it.each(MEMBERSHIP_STATUSES)('refuses the self-loop on %s', (status) => {
    expect(canTransitionMembershipStatus(status, status)).toBe(false);
  });
});

describe('permissionsForTemplate', () => {
  const vocabulary = new Set<string>(Object.values(PERMISSIONS));
  const writeShapedTicketKeys = [
    PERMISSIONS.TICKETS_CREATE,
    PERMISSIONS.TICKETS_ASSIGN_SELF,
    PERMISSIONS.TICKETS_ASSIGN_AGENT,
    PERMISSIONS.TICKETS_REPLY_PUBLIC,
    PERMISSIONS.TICKETS_NOTE_INTERNAL,
    PERMISSIONS.TICKETS_CHANGE_STATUS,
  ];

  it.each(ROLE_TEMPLATES)('maps %s to a non-empty set', (template) => {
    const permissions = permissionsForTemplate(template);
    expect(permissions).toBeDefined();
    expect(permissions.size).toBeGreaterThan(0);
  });

  it.each(ROLE_TEMPLATES)(
    'grants %s nothing outside the shared vocabulary',
    (template) => {
      // The map may narrow the vocabulary, never extend it: an invented key
      // would travel in tokens as a claim nothing can check.
      for (const key of permissionsForTemplate(template)) {
        expect(vocabulary.has(key)).toBe(true);
      }
    },
  );

  it('grants the requester no ticket write beyond creating', () => {
    const requester = permissionsForTemplate('requester');
    const writes = writeShapedTicketKeys.filter((key) => requester.has(key));
    expect(writes).toEqual([PERMISSIONS.TICKETS_CREATE]);
  });

  it('grants the auditor no ticket write at all', () => {
    // Reads everything, changes nothing — the matrix's whole idea of it.
    const auditor = permissionsForTemplate('auditor');
    expect(writeShapedTicketKeys.filter((key) => auditor.has(key))).toEqual([]);
  });

  it('grants the branch-scoped read to the branch manager alone', () => {
    // tickets.read_branch is meaningless without a branch set to scope it,
    // and branch_manager is the only template whose reach is branch-shaped.
    // Desk/team managers must NOT inherit it — their scope is team- and
    // queue-shaped keys that do not exist yet — and admins/agents hold the
    // wider read_all instead.
    const holders = ROLE_TEMPLATES.filter((template) =>
      permissionsForTemplate(template).has(PERMISSIONS.TICKETS_READ_BRANCH),
    );
    expect(holders).toEqual(['branch_manager']);
  });

  it('keeps the branch manager off the organization-wide read', () => {
    // The whole point of the template: their visibility is the branch set,
    // not the tenant.
    expect(
      permissionsForTemplate('branch_manager').has(
        PERMISSIONS.TICKETS_READ_ALL,
      ),
    ).toBe(false);
  });

  it.each(ROLE_TEMPLATES)(
    'grants %s no platform-scoped key (ADR 0015 invariant #1)',
    (template) => {
      for (const key of permissionsForTemplate(template)) {
        expect(key.startsWith('platform.')).toBe(false);
      }
    },
  );
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
    expect(ctx.events.created).toHaveLength(0);
  });

  it('publishes membership.created.v1 once, carrying the consumed correlation id', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());

    const membership = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
      correlationId: 'req-123',
    });

    expect(ctx.events.created).toHaveLength(1);
    expect(ctx.events.created[0].membership).toEqual(membership);
    expect(ctx.events.created[0].correlationId).toBe('req-123');
  });

  it('does not publish again on redelivery', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());

    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });
    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });

    // Once per row, not once per delivery: a replayed registration that
    // re-announced the membership would hand every consumer a duplicate
    // fact to deduplicate on their own.
    expect(ctx.events.created).toHaveLength(1);
  });
});

describe('ChangeMembershipStatusUseCase', () => {
  async function contextWithActiveMembership() {
    const ctx = buildContext();
    ctx.organizations.add(organization());
    const membership = await ctx.ensureMembership.execute({
      userId: USER_ID,
      roles: ['user'],
    });
    return { ...ctx, membership };
  }

  it('suspends an active membership and bumps the version', async () => {
    const ctx = await contextWithActiveMembership();
    ctx.clock.advanceSeconds(60);

    const updated = await ctx.changeMembershipStatus.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      to: 'suspended',
    });

    expect(updated.status).toBe('suspended');
    expect(updated.version).toBe(2);
    expect(updated.updatedAt).toEqual(new Date('2026-07-30T12:01:00.000Z'));
    expect(ctx.memberships.memberships[0]).toEqual(updated);
  });

  it('publishes membership.status-changed.v1 with the pre-transition status', async () => {
    const ctx = await contextWithActiveMembership();

    const updated = await ctx.changeMembershipStatus.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      to: 'suspended',
      correlationId: 'req-456',
    });

    expect(ctx.events.statusChanged).toHaveLength(1);
    const published = ctx.events.statusChanged[0];
    expect(published.membership).toEqual(updated);
    expect(published.fromStatus).toBe('active');
    expect(published.correlationId).toBe('req-456');
  });

  it('bumps the version on every transition', async () => {
    const ctx = await contextWithActiveMembership();

    await ctx.changeMembershipStatus.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      to: 'suspended',
    });
    const reinstated = await ctx.changeMembershipStatus.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      to: 'active',
    });

    // Each bump is what invalidates the `mv` claim in outstanding tokens
    // (ADR 0014); a round trip must not land back on the original version.
    expect(reinstated.version).toBe(3);
    expect(
      ctx.events.statusChanged.map((event) => event.membership.version),
    ).toEqual([2, 3]);
  });

  it('rejects a change for a user with no membership', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());

    await expect(
      ctx.changeMembershipStatus.execute({
        organizationId: BOOTSTRAP_ID,
        userId: USER_ID,
        to: 'suspended',
      }),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
    expect(ctx.events.statusChanged).toHaveLength(0);
  });

  it.each(['invited', 'active'] as const)(
    'rejects the illegal transition active -> %s and leaves the row alone',
    async (to: MembershipStatus) => {
      const ctx = await contextWithActiveMembership();

      await expect(
        ctx.changeMembershipStatus.execute({
          organizationId: BOOTSTRAP_ID,
          userId: USER_ID,
          to,
        }),
      ).rejects.toBeInstanceOf(InvalidMembershipTransitionError);

      expect(ctx.memberships.memberships[0]).toEqual(ctx.membership);
      expect(ctx.events.statusChanged).toHaveLength(0);
    },
  );

  it('names both statuses when refusing', async () => {
    const ctx = await contextWithActiveMembership();

    await expect(
      ctx.changeMembershipStatus.execute({
        organizationId: BOOTSTRAP_ID,
        userId: USER_ID,
        to: 'active',
      }),
    ).rejects.toThrow('from "active" to "active"');
  });

  it('refuses everything out of deactivated', async () => {
    const ctx = await contextWithActiveMembership();
    await ctx.changeMembershipStatus.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      to: 'deactivated',
    });

    await expect(
      ctx.changeMembershipStatus.execute({
        organizationId: BOOTSTRAP_ID,
        userId: USER_ID,
        to: 'active',
      }),
    ).rejects.toBeInstanceOf(InvalidMembershipTransitionError);
  });
});

describe('GetMembershipUseCase', () => {
  it('reports standing with template permissions, whatever the status', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());
    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['agent'] });
    await ctx.changeMembershipStatus.execute({
      organizationId: BOOTSTRAP_ID,
      userId: USER_ID,
      to: 'suspended',
    });

    const view = await ctx.getMembership.execute(BOOTSTRAP_ID, USER_ID);

    // Suspended, yet the permissions are still there: the caller decides
    // what a non-active membership means for the operation it is guarding.
    expect(view.status).toBe('suspended');
    expect(view.roleTemplate).toBe('agent');
    expect(view.membershipVersion).toBe(2);
    expect(view.organizationStatus).toBe('active');
    expect(new Set(view.permissions)).toEqual(permissionsForTemplate('agent'));
  });

  it('reports the organization status alongside the membership', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization({ status: 'suspended' }));
    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });

    const view = await ctx.getMembership.execute(BOOTSTRAP_ID, USER_ID);
    expect(view.organizationStatus).toBe('suspended');
  });

  it('throws MembershipNotFoundError when the pair has no row', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());

    await expect(
      ctx.getMembership.execute(BOOTSTRAP_ID, USER_ID),
    ).rejects.toBeInstanceOf(MembershipNotFoundError);
  });
});

describe('ResolveActiveMembershipUseCase', () => {
  it('resolves the organization and version for an active membership', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());
    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });

    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);

    expect(resolved?.organizationId).toBe(BOOTSTRAP_ID);
    expect(resolved?.membershipVersion).toBe(1);
    // Present and empty, never absent: the field name and the
    // always-present-possibly-empty shape are frozen for auth-service's
    // parser (Sprint 9.5, D2).
    expect(resolved?.branchIds).toEqual([]);
  });

  it.each([
    [['admin'], 'organization_admin'],
    [['agent'], 'agent'],
    [['user'], 'requester'],
  ] as const)(
    'resolves the template permissions for roles %j',
    async (roles, template) => {
      const ctx = buildContext();
      ctx.organizations.add(organization());
      await ctx.ensureMembership.execute({
        userId: USER_ID,
        roles: [...roles],
      });

      const resolved = await ctx.resolveActiveMembership.execute(USER_ID);

      // The `perms` claim is now the code map's answer, not an empty
      // placeholder — the first evaluator increment (ADR 0015).
      expect(new Set(resolved?.permissions)).toEqual(
        permissionsForTemplate(template),
      );
      expect(resolved?.permissions.length).toBeGreaterThan(0);
    },
  );

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

  it('prefers a real organization over the bootstrap one, even when older', async () => {
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

    // Sprint 9.8 changed this from plain oldest-first, and this exact shape is
    // why: registering gives everyone a bootstrap membership, so someone who
    // signs up in order to accept an invitation always has an older row in the
    // migration's holding pen. Oldest-first would make their acceptance
    // invisible and the feature would never demonstrate.
    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);
    expect(resolved?.organizationId).toBe(OTHER_ORG_ID);
  });

  it('still resolves the oldest when both are real organizations', async () => {
    const ctx = buildContext();
    const olderReal = '00000000-0000-4000-8000-0000000000aa';
    ctx.organizations.add(
      organization({ id: olderReal, slug: 'older-real', name: 'Older' }),
    );
    ctx.organizations.add(
      organization({ id: OTHER_ORG_ID, slug: 'other', name: 'Other' }),
    );

    const base = {
      userId: USER_ID,
      roleTemplate: 'requester' as const,
      status: 'active' as const,
      version: 1,
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    };
    ctx.memberships.memberships.push(
      {
        ...base,
        id: 'older-real-membership',
        organizationId: olderReal,
        createdAt: new Date('2026-07-30T10:00:00.000Z'),
      },
      {
        ...base,
        id: 'newer-real-membership',
        organizationId: OTHER_ORG_ID,
        createdAt: new Date('2026-07-30T13:00:00.000Z'),
      },
    );

    // The bootstrap preference is a tiebreak, not a new ordering: among real
    // organizations the original rule stands, and a login must not land
    // somewhere different depending on row order.
    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);
    expect(resolved?.organizationId).toBe(olderReal);
  });

  it('falls back to the bootstrap membership when it is the only one', async () => {
    const ctx = buildContext();
    ctx.organizations.add(organization());

    await ctx.ensureMembership.execute({ userId: USER_ID, roles: ['user'] });

    // The preference must not become a filter: every legacy user reconciled
    // by the backfill has exactly this membership and nothing else.
    const resolved = await ctx.resolveActiveMembership.execute(USER_ID);
    expect(resolved?.organizationId).toBe(BOOTSTRAP_ID);
  });
});
