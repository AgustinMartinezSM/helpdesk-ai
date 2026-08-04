import { TenantContextUnavailableError } from '../domain/errors';
import type { User } from '../domain/user';
import { SessionService } from './session.service';
import {
  FakeMembershipResolver,
  FakeTokenIssuer,
  FixedClock,
  InMemoryRefreshTokenRepository,
  RecordingLogger,
} from './testing/fakes';

const REFRESH_TTL_SECONDS = 3600;
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const BRANCH_A = '00000000-0000-4000-8000-00000000000a';
const BRANCH_B = '00000000-0000-4000-8000-00000000000b';
const TEAM_A = '00000000-0000-4000-8000-00000000000c';
const TEAM_B = '00000000-0000-4000-8000-00000000000d';

const user: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.com',
  passwordHash: 'hashed:whatever',
  roles: ['user', 'agent'],
  createdAt: new Date('2026-07-30T12:00:00.000Z'),
  updatedAt: new Date('2026-07-30T12:00:00.000Z'),
};

function buildSessions(
  memberships?: FakeMembershipResolver,
  logger = new RecordingLogger(),
) {
  const tokenIssuer = new FakeTokenIssuer();
  const sessions = new SessionService(
    new InMemoryRefreshTokenRepository(),
    tokenIssuer,
    new FixedClock(new Date('2026-07-30T12:00:00.000Z')),
    REFRESH_TTL_SECONDS,
    memberships,
    logger,
  );
  return { sessions, tokenIssuer, logger };
}

describe('SessionService tenant claims', () => {
  it('stamps org, perms and mv from the resolved membership', async () => {
    const { sessions, tokenIssuer } = buildSessions(
      FakeMembershipResolver.resolving({
        organizationId: ORGANIZATION_ID,
        permissions: [],
        membershipVersion: 3,
        branchIds: [],
        teamIds: [],
      }),
    );

    await sessions.issueSession(user);

    // The exact-equality here also pins the empty-branch-set case: an
    // unscoped member's claims carry no `br` key at all.
    expect(tokenIssuer.lastClaims).toEqual({
      sub: user.id,
      email: user.email,
      org: ORGANIZATION_ID,
      perms: [],
      mv: 3,
    });
  });

  it('mints br when the membership covers branches', async () => {
    const { sessions, tokenIssuer } = buildSessions(
      FakeMembershipResolver.resolving({
        organizationId: ORGANIZATION_ID,
        permissions: ['tickets.read_branch'],
        membershipVersion: 3,
        branchIds: [BRANCH_A, BRANCH_B],
        teamIds: [],
      }),
    );

    await sessions.issueSession(user);

    expect(tokenIssuer.lastClaims?.br).toEqual([BRANCH_A, BRANCH_B]);
  });

  it('omits br for a membership with an empty branch set', async () => {
    const { sessions, tokenIssuer } = buildSessions(
      FakeMembershipResolver.resolving({
        organizationId: ORGANIZATION_ID,
        permissions: ['tickets.read_branch'],
        membershipVersion: 3,
        branchIds: [],
        teamIds: [],
      }),
    );

    await sessions.issueSession(user);

    // An empty set says nothing an absent claim does not — branch-scoped
    // visibility denies on absence either way — so the claim is omitted,
    // like the other tenant claims are for a user who belongs nowhere.
    expect('br' in (tokenIssuer.lastClaims ?? {})).toBe(false);
    expect(tokenIssuer.lastClaims?.org).toBe(ORGANIZATION_ID);
  });

  it('mints tm when the membership belongs to support teams', async () => {
    // No test passed a non-empty team set through this path until Sprint 10.6,
    // which is half of why the dropped `tm` claim survived four sprints. The
    // other half — that this asserts what the issuer was HANDED rather than
    // what it signed — is covered by jwt-token-issuer.spec.ts, which decodes.
    const { sessions, tokenIssuer } = buildSessions(
      FakeMembershipResolver.resolving({
        organizationId: ORGANIZATION_ID,
        permissions: ['tickets.read_team'],
        membershipVersion: 3,
        branchIds: [],
        teamIds: [TEAM_A, TEAM_B],
      }),
    );

    await sessions.issueSession(user);

    expect(tokenIssuer.lastClaims?.tm).toEqual([TEAM_A, TEAM_B]);
  });

  it('omits tm for a membership in no team', async () => {
    const { sessions, tokenIssuer } = buildSessions(
      FakeMembershipResolver.resolving({
        organizationId: ORGANIZATION_ID,
        permissions: ['tickets.read_team'],
        membershipVersion: 3,
        branchIds: [],
        teamIds: [],
      }),
    );

    await sessions.issueSession(user);

    // Same terms as `br`: team-scoped visibility denies on absence either way.
    expect('tm' in (tokenIssuer.lastClaims ?? {})).toBe(false);
  });

  it('mints no roles claim, while the session response keeps user.roles', async () => {
    const { sessions, tokenIssuer } = buildSessions(
      FakeMembershipResolver.resolving({
        organizationId: ORGANIZATION_ID,
        permissions: ['tickets.read_own'],
        membershipVersion: 1,
        branchIds: [],
        teamIds: [],
      }),
    );

    const session = await sessions.issueSession(user);

    // Phase 8 removed the compatibility claim: authorization reads perms.
    // The response contract is a separate thing and survives byte-for-byte —
    // the product's role names come from the user row, and the web renders
    // them from here, never from the token.
    expect('roles' in (tokenIssuer.lastClaims ?? {})).toBe(false);
    expect(tokenIssuer.lastClaims?.perms).toEqual(['tickets.read_own']);
    expect(session.user).toEqual({
      id: user.id,
      email: user.email,
      roles: ['user', 'agent'],
    });
  });

  it('omits the tenant claims entirely for a user with no membership', async () => {
    const { sessions, tokenIssuer, logger } = buildSessions(
      FakeMembershipResolver.resolvingNothing(),
    );

    await sessions.issueSession(user);

    expect(tokenIssuer.lastClaims).toEqual({
      sub: user.id,
      email: user.email,
    });
    expect('org' in (tokenIssuer.lastClaims ?? {})).toBe(false);
    expect('br' in (tokenIssuer.lastClaims ?? {})).toBe(false);
    // Belonging nowhere is a real answer, not a fault. It is the state of
    // every account between registering and the consumer creating its
    // membership, so the token is issued and the write paths are what refuse.
    expect(logger.warnings).toEqual([]);
    expect(logger.errors).toEqual([]);
  });

  it('refuses to mint when resolution fails', async () => {
    const { sessions, tokenIssuer, logger } = buildSessions(
      FakeMembershipResolver.failing('connect ECONNREFUSED 127.0.0.1:3010'),
    );

    // "I could not ask" is not "they belong nowhere". Minting on that
    // uncertainty would produce a tenant-less token, and the write paths now
    // take the organization from the token — so it would write rows that
    // belong to nobody and look exactly like rows meant to be global.
    await expect(sessions.issueSession(user)).rejects.toBeInstanceOf(
      TenantContextUnavailableError,
    );
    expect(tokenIssuer.issued).toEqual([]);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('ECONNREFUSED');
  });

  it('does not create a refresh token for a session it refused to mint', async () => {
    const refreshTokens = new InMemoryRefreshTokenRepository();
    const sessions = new SessionService(
      refreshTokens,
      new FakeTokenIssuer(),
      new FixedClock(new Date('2026-07-30T12:00:00.000Z')),
      REFRESH_TTL_SECONDS,
      FakeMembershipResolver.failing(),
      new RecordingLogger(),
    );

    await expect(sessions.issueSession(user)).rejects.toBeInstanceOf(
      TenantContextUnavailableError,
    );
    // Resolution happens before anything is persisted, so a refused mint
    // leaves no orphan refresh row behind.
    expect(refreshTokens.tokens.size).toBe(0);
  });

  it('mints without tenant claims when no resolver is configured', async () => {
    const { sessions, tokenIssuer, logger } = buildSessions(undefined);

    await sessions.issueSession(user);

    expect(tokenIssuer.lastClaims?.org).toBeUndefined();
    expect(logger.warnings).toEqual([]);
  });

  it('resolves once per mint, for the user being minted', async () => {
    const memberships = FakeMembershipResolver.resolving({
      organizationId: ORGANIZATION_ID,
      permissions: [],
      membershipVersion: 1,
      branchIds: [],
      teamIds: [],
    });
    const { sessions } = buildSessions(memberships);

    await sessions.issueSession(user);
    await sessions.issueSession(user);

    // Refresh mints a new token, so it resolves again — that is what bounds
    // membership staleness to one access-token TTL.
    expect(memberships.calls).toEqual([user.id, user.id]);
  });
});
