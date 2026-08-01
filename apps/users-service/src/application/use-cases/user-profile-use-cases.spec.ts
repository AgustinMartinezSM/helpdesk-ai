import {
  NoOrganizationContextError,
  PERMISSIONS,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenProfileActionError,
  ProfileNotFoundError,
} from '../../domain/errors';
import { LOST_CREATED_ROLE_TEMPLATE } from '../../domain/directory-membership';
import { displayNameFromEmail } from '../../domain/user-profile';
import {
  FixedClock,
  InMemoryMembershipProjectionRepository,
  InMemoryUserProfileRepository,
} from '../testing/fakes';
import {
  ApplyMembershipCreatedUseCase,
  ApplyMembershipRoleChangedUseCase,
  ApplyMembershipStatusChangedUseCase,
} from './apply-membership-events';
import {
  GetMyProfileUseCase,
  ListUserProfilesUseCase,
} from './profile-queries';
import { RegisterUserProfileUseCase } from './register-user-profile';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// Member-shaped but without people.read: proves the directory gate rejects
// on the missing key, not on an empty token.
const USER: Actor = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: ORG_A,
  permissions: new Set([PERMISSIONS.ORGANIZATION_READ]),
};
const AGENT: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: ORG_A,
  permissions: new Set([PERMISSIONS.PEOPLE_READ]),
};
// people.read but no organization: the state of a token minted between
// registering and the membership projection catching up.
const TENANTLESS_AGENT: Actor = {
  id: '55555555-5555-4555-8555-555555555555',
  permissions: new Set([PERMISSIONS.PEOPLE_READ]),
};

const REGISTRATION = {
  userId: USER.id,
  email: 'ada.lovelace@example.com',
  registeredAt: new Date('2026-07-28T12:00:00.000Z'),
};

function buildContext() {
  const memberships = new InMemoryMembershipProjectionRepository();
  const profiles = new InMemoryUserProfileRepository(memberships);
  const clock = new FixedClock(new Date('2026-07-28T12:00:05.000Z'));
  return {
    memberships,
    profiles,
    clock,
    register: new RegisterUserProfileUseCase(profiles, clock),
    applyCreated: new ApplyMembershipCreatedUseCase(memberships),
    applyStatusChanged: new ApplyMembershipStatusChangedUseCase(memberships),
    applyRoleChanged: new ApplyMembershipRoleChangedUseCase(memberships),
    getMine: new GetMyProfileUseCase(profiles),
    list: new ListUserProfilesUseCase(profiles),
  };
}

/** Active membership shortcut for specs that only need directory presence. */
async function joinOrganization(
  ctx: ReturnType<typeof buildContext>,
  organizationId: string,
  userId: string,
) {
  await ctx.applyCreated.execute({
    organizationId,
    userId,
    roleTemplate: 'requester',
    status: 'active',
    occurredAt: new Date('2026-07-28T12:00:01.000Z'),
  });
}

describe('displayNameFromEmail', () => {
  it('uses the local part and survives degenerate inputs', () => {
    expect(displayNameFromEmail('ada.lovelace@example.com')).toBe(
      'ada.lovelace',
    );
    expect(displayNameFromEmail('@example.com')).toBe('@example.com');
  });
});

describe('RegisterUserProfileUseCase', () => {
  it('projects a registration event into a profile', async () => {
    const ctx = buildContext();

    const profile = await ctx.register.execute(REGISTRATION);

    expect(profile).toEqual({
      userId: USER.id,
      email: 'ada.lovelace@example.com',
      displayName: 'ada.lovelace',
      registeredAt: REGISTRATION.registeredAt,
      createdAt: ctx.clock.now(),
      updatedAt: ctx.clock.now(),
    });
  });

  it('is idempotent under redelivery and keeps the original display name', async () => {
    const ctx = buildContext();
    const first = await ctx.register.execute(REGISTRATION);

    // Simulate a manual rename before the duplicate delivery arrives.
    await ctx.profiles.upsert({ ...first, displayName: 'Ada' });
    ctx.clock.advanceSeconds(60);

    await ctx.register.execute(REGISTRATION);

    expect(ctx.profiles.profiles.size).toBe(1);
    const stored = await ctx.profiles.findByUserId(USER.id);
    expect(stored?.displayName).toBe('Ada');
    expect(stored?.createdAt).toEqual(first.createdAt);
  });
});

describe('membership projection', () => {
  const EDGE = { organizationId: ORG_A, userId: USER.id };

  it('projects a created event into a directory membership row', async () => {
    const ctx = buildContext();

    await ctx.applyCreated.execute({
      ...EDGE,
      roleTemplate: 'agent',
      status: 'active',
      occurredAt: new Date('2026-07-28T12:00:01.000Z'),
    });

    expect(ctx.memberships.rows.get(`${ORG_A}:${USER.id}`)).toEqual({
      ...EDGE,
      roleTemplate: 'agent',
      status: 'active',
      updatedAt: new Date('2026-07-28T12:00:01.000Z'),
    });
  });

  it('applies a newer status-change and ignores a stale replay', async () => {
    const ctx = buildContext();
    await ctx.applyCreated.execute({
      ...EDGE,
      roleTemplate: 'agent',
      status: 'active',
      occurredAt: new Date('2026-07-28T12:00:01.000Z'),
    });

    await ctx.applyStatusChanged.execute({
      ...EDGE,
      toStatus: 'suspended',
      occurredAt: new Date('2026-07-28T13:00:00.000Z'),
    });

    // A stale event replayed later (e.g. DLQ replay) must not regress.
    await ctx.applyStatusChanged.execute({
      ...EDGE,
      toStatus: 'active',
      occurredAt: new Date('2026-07-28T12:30:00.000Z'),
    });

    const stored = ctx.memberships.rows.get(`${ORG_A}:${USER.id}`);
    expect(stored?.status).toBe('suspended');
    expect(stored?.roleTemplate).toBe('agent');
    expect(stored?.updatedAt).toEqual(new Date('2026-07-28T13:00:00.000Z'));
  });

  it('applies a newer role-change and ignores a stale replay', async () => {
    const ctx = buildContext();
    await ctx.applyCreated.execute({
      ...EDGE,
      roleTemplate: 'requester',
      status: 'active',
      occurredAt: new Date('2026-07-28T12:00:01.000Z'),
    });

    await expect(
      ctx.applyRoleChanged.execute({
        ...EDGE,
        toTemplate: 'agent',
        occurredAt: new Date('2026-07-28T13:00:00.000Z'),
      }),
    ).resolves.toBe(true);

    // A stale event replayed later (e.g. DLQ replay) must not regress.
    await ctx.applyRoleChanged.execute({
      ...EDGE,
      toTemplate: 'requester',
      occurredAt: new Date('2026-07-28T12:30:00.000Z'),
    });

    const stored = ctx.memberships.rows.get(`${ORG_A}:${USER.id}`);
    expect(stored?.roleTemplate).toBe('agent');
    expect(stored?.status).toBe('active');
    expect(stored?.updatedAt).toEqual(new Date('2026-07-28T13:00:00.000Z'));
  });

  it('skips a role-change on an unseen edge without inventing a row', async () => {
    const ctx = buildContext();

    // Unlike the status-change placeholder below, nothing here can err
    // downward: a template without a status is a guess in both directions,
    // so the skip (surfaced as false, warned by the consumer) plus the
    // operator script are the recovery path.
    await expect(
      ctx.applyRoleChanged.execute({
        ...EDGE,
        toTemplate: 'agent',
        occurredAt: new Date('2026-07-28T13:00:00.000Z'),
      }),
    ).resolves.toBe(false);

    expect(ctx.memberships.rows.size).toBe(0);
  });

  it('creates a requester-shaped row for a status-change on an unseen edge', async () => {
    const ctx = buildContext();

    // The created event was lost; storing the least-privileged template errs
    // downward, and the operator script reconciles the truth.
    await ctx.applyStatusChanged.execute({
      ...EDGE,
      toStatus: 'suspended',
      occurredAt: new Date('2026-07-28T13:00:00.000Z'),
    });

    expect(ctx.memberships.rows.get(`${ORG_A}:${USER.id}`)).toEqual({
      ...EDGE,
      roleTemplate: LOST_CREATED_ROLE_TEMPLATE,
      status: 'suspended',
      updatedAt: new Date('2026-07-28T13:00:00.000Z'),
    });
  });
});

describe('profile queries', () => {
  it('returns the caller profile and 404s before projection', async () => {
    const ctx = buildContext();

    await expect(ctx.getMine.execute(USER)).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );

    await ctx.register.execute(REGISTRATION);
    const profile = await ctx.getMine.execute(USER);
    expect(profile.userId).toBe(USER.id);
  });

  it('restricts the directory to people.read holders', async () => {
    const ctx = buildContext();
    await ctx.register.execute(REGISTRATION);
    await joinOrganization(ctx, ORG_A, USER.id);

    await expect(ctx.list.execute(USER)).rejects.toBeInstanceOf(
      ForbiddenProfileActionError,
    );

    const directory = await ctx.list.execute(AGENT);
    expect(directory.map((p) => p.userId)).toEqual([USER.id]);
  });

  it('refuses a tenantless actor even with people.read', async () => {
    const ctx = buildContext();
    await ctx.register.execute(REGISTRATION);
    await joinOrganization(ctx, ORG_A, USER.id);

    await expect(ctx.list.execute(TENANTLESS_AGENT)).rejects.toBeInstanceOf(
      NoOrganizationContextError,
    );
  });

  it('isolates organizations by membership identity, not by profile data', async () => {
    const ctx = buildContext();
    const outsiderId = '99999999-9999-4999-8999-999999999999';

    // Two people who look identical in the directory — same display name —
    // so only the membership edge can tell them apart.
    await ctx.register.execute(REGISTRATION);
    await ctx.register.execute({
      userId: outsiderId,
      email: 'ada.lovelace@rival.example.com',
      registeredAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    await joinOrganization(ctx, ORG_A, USER.id);
    await joinOrganization(ctx, ORG_B, outsiderId);

    const directory = await ctx.list.execute(AGENT);
    expect(directory.map((p) => p.userId)).toEqual([USER.id]);
  });

  it('drops a suspended member from the listing', async () => {
    const ctx = buildContext();
    await ctx.register.execute(REGISTRATION);
    await joinOrganization(ctx, ORG_A, USER.id);

    expect(await ctx.list.execute(AGENT)).toHaveLength(1);

    await ctx.applyStatusChanged.execute({
      organizationId: ORG_A,
      userId: USER.id,
      toStatus: 'suspended',
      occurredAt: new Date('2026-07-28T13:00:00.000Z'),
    });

    expect(await ctx.list.execute(AGENT)).toEqual([]);
  });
});
