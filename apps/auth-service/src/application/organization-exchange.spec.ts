import { OrganizationNotAvailableError } from '../domain/errors';
import type { User } from '../domain/user';
import type { ResolvedMembership } from './ports/membership-resolver';
import { SessionService } from './session.service';
import { ExchangeOrganizationUseCase } from './use-cases/exchange-organization';
import { RefreshSessionUseCase } from './use-cases/refresh-session';
import {
  FakeMembershipResolver,
  FakeTokenIssuer,
  FixedClock,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  RecordingLogger,
} from './testing/fakes';

/**
 * Choosing which organization a token is minted for (Sprint 10.6, ADR 0025).
 *
 * The property most of this file exists to pin: a requested organization is a
 * REQUEST. It is validated against the stored membership before anything is
 * signed, and the two callers do different things with a refusal — the
 * exchange says no, a refresh falls back — which is the difference between
 * "you cannot go there" and "you are not there any more".
 */

const REFRESH_TTL_SECONDS = 3600;
const NOW = new Date('2026-08-04T12:00:00.000Z');

const ACME = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
const THEIRS = '00000000-0000-4000-8000-0000000000cc';

const BRANCH = '00000000-0000-4000-8000-00000000000a';
const TEAM = '00000000-0000-4000-8000-00000000000c';

const user: User = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'ada@example.com',
  passwordHash: 'hashed:whatever',
  roles: ['user'],
  createdAt: NOW,
  updatedAt: NOW,
};

function membership(
  over: Partial<ResolvedMembership> = {},
): ResolvedMembership {
  return {
    organizationId: ACME,
    permissions: ['tickets.read_own'],
    membershipVersion: 1,
    branchIds: [],
    teamIds: [],
    ...over,
  };
}

/** Acme by default, Other reachable by asking, Theirs held by nobody. */
function build(resolver?: FakeMembershipResolver) {
  const memberships =
    resolver ??
    FakeMembershipResolver.withOrganizations(
      membership(),
      membership(),
      membership({
        organizationId: OTHER,
        permissions: ['tickets.read_all', 'people.read'],
        membershipVersion: 9,
        branchIds: [BRANCH],
        teamIds: [TEAM],
      }),
    );

  const refreshTokens = new InMemoryRefreshTokenRepository();
  const tokenIssuer = new FakeTokenIssuer();
  const users = new InMemoryUserRepository();
  users.users.set(user.id, user);
  const logger = new RecordingLogger();
  const sessions = new SessionService(
    refreshTokens,
    tokenIssuer,
    new FixedClock(NOW),
    REFRESH_TTL_SECONDS,
    memberships,
    logger,
  );

  return {
    memberships,
    refreshTokens,
    tokenIssuer,
    sessions,
    logger,
    exchange: new ExchangeOrganizationUseCase(users, sessions),
    refresh: new RefreshSessionUseCase(
      users,
      refreshTokens,
      sessions,
      new FixedClock(NOW),
    ),
  };
}

describe('exchanging a token for another organization', () => {
  it('mints for the requested organization, with ITS permissions and scope', async () => {
    const ctx = build();

    const exchanged = await ctx.exchange.execute({
      userId: user.id,
      organizationId: OTHER,
    });

    expect(exchanged.organizationId).toBe(OTHER);
    expect(exchanged.permissions).toEqual(['tickets.read_all', 'people.read']);
    // Every claim describes the SAME row. A token whose org is one tenant and
    // whose perms or team scope are another's would pass every check
    // downstream, so they are asserted together rather than one at a time.
    expect(ctx.tokenIssuer.lastClaims).toEqual({
      sub: user.id,
      email: user.email,
      org: OTHER,
      perms: ['tickets.read_all', 'people.read'],
      mv: 9,
      br: [BRANCH],
      tm: [TEAM],
    });
  });

  it('refuses an organization the caller does not hold', async () => {
    const ctx = build();

    await expect(
      ctx.exchange.execute({ userId: user.id, organizationId: THEIRS }),
    ).rejects.toBeInstanceOf(OrganizationNotAvailableError);
  });

  it('refuses without minting anything', async () => {
    const ctx = build();

    await expect(
      ctx.exchange.execute({ userId: user.id, organizationId: THEIRS }),
    ).rejects.toBeInstanceOf(OrganizationNotAvailableError);

    expect(ctx.tokenIssuer.issued).toEqual([]);
  });

  it('does NOT create a refresh token: switching is not starting a session', async () => {
    // The shape of the decision (ADR 0025). The refresh family belongs to the
    // person, so a change of context leaves the born window and reuse
    // detection entirely untouched.
    const ctx = build();

    await ctx.exchange.execute({ userId: user.id, organizationId: OTHER });

    expect(ctx.refreshTokens.tokens.size).toBe(0);
  });

  it('refuses rather than falling back — the caller asked to go somewhere', async () => {
    // The difference from a refresh. Somebody who explicitly chose must be
    // told they cannot, not quietly left where they were and shown a screen
    // that says otherwise.
    const ctx = build();

    await expect(
      ctx.exchange.execute({ userId: user.id, organizationId: THEIRS }),
    ).rejects.toBeInstanceOf(OrganizationNotAvailableError);
    // …and it never fell through to the default resolution.
    expect(ctx.memberships.requested).toEqual([THEIRS]);
  });

  it('refuses a token whose account no longer exists', async () => {
    const ctx = build();

    await expect(
      ctx.exchange.execute({
        userId: '99999999-9999-4999-8999-999999999999',
        organizationId: OTHER,
      }),
    ).rejects.toBeInstanceOf(OrganizationNotAvailableError);
  });
});

describe('refreshing with a remembered organization', () => {
  async function sessionFor(ctx: ReturnType<typeof build>) {
    return ctx.sessions.issueSession(user);
  }

  it('resumes in the remembered one', async () => {
    const ctx = build();
    const first = await sessionFor(ctx);

    const resumed = await ctx.refresh.execute({
      refreshToken: first.refreshToken,
      organizationId: OTHER,
    });

    expect(resumed.organizationId).toBe(OTHER);
  });

  it('FALLS BACK instead of failing when the choice is no longer available', async () => {
    // The case that must never sign anybody out: removed from the
    // organization their client remembers. "Not that one" is an answer, not
    // the uncertainty TenantContextUnavailableError exists for.
    const ctx = build();
    const first = await sessionFor(ctx);

    const resumed = await ctx.refresh.execute({
      refreshToken: first.refreshToken,
      organizationId: THEIRS,
    });

    expect(resumed.organizationId).toBe(ACME);
    // The client learns of the substitution by reading the session back,
    // which is also what it needs in order to stop asking.
    expect(ctx.memberships.requested).toEqual([undefined, THEIRS, undefined]);
    expect(ctx.logger.warnings).toHaveLength(1);
    expect(ctx.logger.warnings[0]).toContain(THEIRS);
  });

  it('uses the default rule when nothing is remembered', async () => {
    const ctx = build();
    const first = await sessionFor(ctx);

    const resumed = await ctx.refresh.execute({
      refreshToken: first.refreshToken,
    });

    expect(resumed.organizationId).toBe(ACME);
    expect(ctx.memberships.requested).toEqual([undefined, undefined]);
  });

  it('keeps the born window across a switch, so a shared terminal stays short', async () => {
    // Rotation still inherits expiresAt - createdAt of the presented token
    // (Sprint 9.7). Choosing an organization must not be a way to lengthen a
    // session opened on a till.
    const ctx = build();
    const short = await ctx.sessions.issueSession(user, {
      refreshTtlSeconds: 60,
    });

    const resumed = await ctx.refresh.execute({
      refreshToken: short.refreshToken,
      organizationId: OTHER,
    });

    const rotated = ctx.refreshTokens.tokens.get(resumed.refreshTokenId);
    expect(
      Math.round(
        (rotated!.expiresAt.getTime() - rotated!.createdAt.getTime()) / 1000,
      ),
    ).toBe(60);
  });

  it('still refuses to mint when resolution CANNOT be reached', async () => {
    // The distinction the fallback must not swallow: "not that one" falls
    // back, "I could not ask" still refuses with a 503.
    const ctx = build();
    const first = await sessionFor(build());
    const failing = build(FakeMembershipResolver.failing());

    await expect(
      failing.refresh.execute({
        refreshToken: first.refreshToken,
        organizationId: OTHER,
      }),
    ).rejects.toThrow();
    expect(ctx.tokenIssuer.issued).toHaveLength(0);
  });
});
