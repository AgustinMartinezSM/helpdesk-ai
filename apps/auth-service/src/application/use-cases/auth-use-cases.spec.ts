import {
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  RefreshTokenReuseError,
} from '../../domain/errors';
import { parseRefreshToken } from '../refresh-token.codec';
import { SessionService } from '../session.service';
import {
  FakeEventPublisher,
  FakeMembershipResolver,
  FakePasswordHasher,
  FakeTokenIssuer,
  FixedClock,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
} from '../testing/fakes';
import { LoginUseCase } from './login';
import { LogoutUseCase } from './logout';
import { RefreshSessionUseCase } from './refresh-session';
import { RegisterUserUseCase } from './register-user';

const REFRESH_TTL_SECONDS = 3600;
const SHARED_REFRESH_TTL_SECONDS = 1800;

function buildContext() {
  const users = new InMemoryUserRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const hasher = new FakePasswordHasher();
  const clock = new FixedClock(new Date('2026-07-28T12:00:00.000Z'));
  const events = new FakeEventPublisher();
  const sessions = new SessionService(
    refreshTokens,
    new FakeTokenIssuer(),
    clock,
    REFRESH_TTL_SECONDS,
    // Belongs-nowhere, which is what these cases assumed while the parameter
    // was optional — but stated rather than inherited from a default. The
    // tenant claims are session-claims.spec.ts's subject, not this file's.
    FakeMembershipResolver.resolvingNothing(),
  );

  return {
    users,
    refreshTokens,
    hasher,
    clock,
    events,
    sessions,
    register: new RegisterUserUseCase(users, hasher, clock, events),
    login: new LoginUseCase(
      users,
      hasher,
      sessions,
      SHARED_REFRESH_TTL_SECONDS,
    ),
    refresh: new RefreshSessionUseCase(users, refreshTokens, sessions, clock),
    logout: new LogoutUseCase(refreshTokens, clock),
  };
}

describe('RegisterUserUseCase', () => {
  it('creates a user with a hashed password, default role and normalized email', async () => {
    const ctx = buildContext();

    const output = await ctx.register.execute({
      email: '  Agent@Example.COM ',
      password: 'correct horse battery',
    });

    expect(output.email).toBe('agent@example.com');
    expect(output.roles).toEqual(['user']);

    const stored = await ctx.users.findByEmail('agent@example.com');
    expect(stored?.passwordHash).toBe('hashed:correct horse battery');
  });

  it('publishes user.registered with the created user identity', async () => {
    const ctx = buildContext();

    const output = await ctx.register.execute({
      email: 'ada@example.com',
      password: 'correct horse battery',
    });

    expect(ctx.events.published).toEqual([
      {
        userId: output.id,
        email: 'ada@example.com',
        roles: ['user'],
        registeredAt: ctx.clock.now(),
      },
    ]);
  });

  it('rejects an email that is already registered, regardless of casing', async () => {
    const ctx = buildContext();
    await ctx.register.execute({ email: 'a@b.com', password: 'x'.repeat(12) });

    await expect(
      ctx.register.execute({ email: 'A@B.com', password: 'y'.repeat(12) }),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);

    // The failed duplicate must not leak an event.
    expect(ctx.events.published).toHaveLength(1);
  });
});

describe('LoginUseCase', () => {
  it('returns a full session for valid credentials', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    const session = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    expect(session.accessToken).toMatch(/^access:/);
    expect(session.expiresInSeconds).toBe(900);
    expect(parseRefreshToken(session.refreshToken)).not.toBeNull();
    expect(session.user.email).toBe('a@b.com');
  });

  it('rejects a wrong password with the generic credentials error', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    await expect(
      ctx.login.execute({ email: 'a@b.com', password: 'wrong-password-1' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('shortens the refresh window when the machine is declared shared, and only shortens', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    const shared = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
      sharedWorkstation: true,
    });
    const sharedRow = ctx.refreshTokens.tokens.get(
      parseRefreshToken(shared.refreshToken)!.id,
    )!;
    expect(sharedRow.expiresAt.getTime() - sharedRow.createdAt.getTime()).toBe(
      SHARED_REFRESH_TTL_SECONDS * 1000,
    );

    // Omitting the flag keeps exactly today's window.
    const normal = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const normalRow = ctx.refreshTokens.tokens.get(
      parseRefreshToken(normal.refreshToken)!.id,
    )!;
    expect(normalRow.expiresAt.getTime() - normalRow.createdAt.getTime()).toBe(
      REFRESH_TTL_SECONDS * 1000,
    );
  });

  it('caps a misconfigured shared TTL at the normal one — the flag cannot stretch', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const oversharing = new LoginUseCase(
      ctx.users,
      ctx.hasher,
      ctx.sessions,
      REFRESH_TTL_SECONDS * 2,
    );

    const session = await oversharing.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
      sharedWorkstation: true,
    });
    const row = ctx.refreshTokens.tokens.get(
      parseRefreshToken(session.refreshToken)!.id,
    )!;
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
      REFRESH_TTL_SECONDS * 1000,
    );
  });

  it('rejects an unknown email identically, burning hash time against enumeration', async () => {
    const ctx = buildContext();
    const hashCallsBefore = ctx.hasher.hashCalls;

    await expect(
      ctx.login.execute({ email: 'ghost@b.com', password: 'whatever-12345' }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    expect(ctx.hasher.hashCalls).toBe(hashCallsBefore + 1);
  });
});

describe('RefreshSessionUseCase', () => {
  it('rotates the token: old one revoked and linked to its replacement', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const first = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    const second = await ctx.refresh.execute({
      refreshToken: first.refreshToken,
    });

    expect(second.refreshToken).not.toBe(first.refreshToken);

    const oldStored = await ctx.refreshTokens.findById(first.refreshTokenId);
    expect(oldStored?.revokedAt).not.toBeNull();
    expect(oldStored?.replacedById).toBe(second.refreshTokenId);
  });

  it('keeps the born window across rotation: shared stays short, normal stays normal', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    const shared = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
      sharedWorkstation: true,
    });
    const rotatedShared = await ctx.refresh.execute({
      refreshToken: shared.refreshToken,
    });
    const sharedRow = ctx.refreshTokens.tokens.get(
      rotatedShared.refreshTokenId,
    )!;
    // The replacement inherits the window the presented token was born
    // with — a shared session cannot stretch itself by rotating.
    expect(sharedRow.expiresAt.getTime() - sharedRow.createdAt.getTime()).toBe(
      SHARED_REFRESH_TTL_SECONDS * 1000,
    );

    const normal = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const rotatedNormal = await ctx.refresh.execute({
      refreshToken: normal.refreshToken,
    });
    const normalRow = ctx.refreshTokens.tokens.get(
      rotatedNormal.refreshTokenId,
    )!;
    expect(normalRow.expiresAt.getTime() - normalRow.createdAt.getTime()).toBe(
      REFRESH_TTL_SECONDS * 1000,
    );
  });

  it('rejects an expired token', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const session = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    ctx.clock.advanceSeconds(REFRESH_TTL_SECONDS + 1);

    await expect(
      ctx.refresh.execute({ refreshToken: session.refreshToken }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('rejects a token with a tampered secret', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const session = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    const { id } = parseRefreshToken(session.refreshToken)!;

    await expect(
      ctx.refresh.execute({ refreshToken: `${id}.forged-secret` }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenError);
  });

  it('treats reuse of a rotated token as theft and revokes every session', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const first = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const second = await ctx.refresh.execute({
      refreshToken: first.refreshToken,
    });

    // Replay of the already-rotated first token.
    await expect(
      ctx.refresh.execute({ refreshToken: first.refreshToken }),
    ).rejects.toBeInstanceOf(RefreshTokenReuseError);

    // The legitimate second token must be dead too.
    expect(ctx.refreshTokens.activeTokensFor(second.user.id)).toHaveLength(0);
    await expect(
      ctx.refresh.execute({ refreshToken: second.refreshToken }),
    ).rejects.toBeInstanceOf(RefreshTokenReuseError);
  });
});

describe('LogoutUseCase', () => {
  it('revokes the presented token', async () => {
    const ctx = buildContext();
    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const session = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });

    await ctx.logout.execute({ refreshToken: session.refreshToken });

    const stored = await ctx.refreshTokens.findById(session.refreshTokenId);
    expect(stored?.revokedAt).not.toBeNull();
    await expect(
      ctx.refresh.execute({ refreshToken: session.refreshToken }),
    ).rejects.toBeInstanceOf(RefreshTokenReuseError);
  });

  it('is idempotent for garbage, unknown and already-revoked tokens', async () => {
    const ctx = buildContext();

    await expect(
      ctx.logout.execute({ refreshToken: 'not-a-token' }),
    ).resolves.toBeUndefined();

    await ctx.register.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    const session = await ctx.login.execute({
      email: 'a@b.com',
      password: 'secret-pass-123',
    });
    await ctx.logout.execute({ refreshToken: session.refreshToken });
    await expect(
      ctx.logout.execute({ refreshToken: session.refreshToken }),
    ).resolves.toBeUndefined();
  });
});
