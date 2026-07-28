import { randomUUID } from 'node:crypto';
import { EmailAlreadyRegisteredError } from '../../domain/errors';
import type { User } from '../../domain/user';
import { PrismaRefreshTokenRepository } from './prisma-refresh-token.repository';
import { PrismaUserRepository } from './prisma-user.repository';
import { PrismaService } from './prisma.service';

// Runs against helpdesk_auth_test through the test-integration target,
// which exports DATABASE_URL and applies migrations first.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run via `nx run @helpdesk-ai/auth-service:test-integration` with the compose postgres service up.',
  );
}

describe('Prisma repositories (real PostgreSQL)', () => {
  const prisma = new PrismaService(databaseUrl);
  const users = new PrismaUserRepository(prisma);
  const refreshTokens = new PrismaRefreshTokenRepository(prisma);

  const now = () => new Date();

  function buildUser(overrides: Partial<User> = {}): User {
    const timestamp = now();
    return {
      id: randomUUID(),
      email: `${randomUUID()}@example.com`,
      passwordHash: '$argon2id$fake-hash-for-tests',
      roles: ['user'],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...overrides,
    };
  }

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await prisma.$disconnect();
  });

  it('persists and reads users with roles and timestamps intact', async () => {
    const user = buildUser({ email: 'roundtrip@example.com' });

    await users.create(user);

    const byEmail = await users.findByEmail('roundtrip@example.com');
    expect(byEmail).toMatchObject({
      id: user.id,
      email: user.email,
      passwordHash: user.passwordHash,
      roles: ['user'],
    });
    expect(byEmail?.createdAt.getTime()).toBe(user.createdAt.getTime());

    const byId = await users.findById(user.id);
    expect(byId?.email).toBe(user.email);
    expect(await users.findById(randomUUID())).toBeNull();
  });

  it('maps the unique email violation to EmailAlreadyRegisteredError', async () => {
    const user = buildUser({ email: 'unique@example.com' });
    await users.create(user);

    await expect(
      users.create(buildUser({ email: 'unique@example.com' })),
    ).rejects.toBeInstanceOf(EmailAlreadyRegisteredError);
  });

  it('creates, revokes and mass-revokes refresh tokens', async () => {
    const user = buildUser();
    await users.create(user);

    const timestamp = now();
    const tokenA = {
      id: randomUUID(),
      userId: user.id,
      tokenHash: 'a'.repeat(64),
      expiresAt: new Date(timestamp.getTime() + 60_000),
      createdAt: timestamp,
      revokedAt: null,
      replacedById: null,
    };
    const tokenB = { ...tokenA, id: randomUUID(), tokenHash: 'b'.repeat(64) };
    await refreshTokens.create(tokenA);
    await refreshTokens.create(tokenB);

    const replacement = randomUUID();
    const firstRevocation = new Date();
    await refreshTokens.revoke(tokenA.id, firstRevocation, replacement);

    const revoked = await refreshTokens.findById(tokenA.id);
    expect(revoked?.revokedAt?.getTime()).toBe(firstRevocation.getTime());
    expect(revoked?.replacedById).toBe(replacement);

    // A second revoke must not overwrite the original revocation.
    await refreshTokens.revoke(tokenA.id, new Date(Date.now() + 5_000));
    const stillFirst = await refreshTokens.findById(tokenA.id);
    expect(stillFirst?.revokedAt?.getTime()).toBe(firstRevocation.getTime());

    await refreshTokens.revokeAllForUser(user.id, new Date());
    const b = await refreshTokens.findById(tokenB.id);
    expect(b?.revokedAt).not.toBeNull();
  });
});
