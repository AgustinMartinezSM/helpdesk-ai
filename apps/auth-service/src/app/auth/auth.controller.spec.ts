import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { MEMBERSHIP_RESOLVER } from '../../application/ports/membership-resolver';
import { PASSWORD_HASHER } from '../../application/ports/password-hasher';
import { REFRESH_TOKEN_REPOSITORY } from '../../application/ports/refresh-token.repository';
import { USER_REPOSITORY } from '../../application/ports/user.repository';
import {
  FakeEventPublisher,
  FakeMembershipResolver,
  FakePasswordHasher,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
} from '../../application/testing/fakes';
import { authServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';

// Fast HTTP tests: real Nest wiring, validation and JWT, with in-memory
// persistence fakes and a fake hasher so no Docker (and no argon2 cost)
// is involved. Real-database coverage lives in the *.int.spec.ts suites.
const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  // Required since Sprint 10.8: the module cannot be built without it. Every
  // suite below overrides MEMBERSHIP_RESOLVER, so the value is never used to
  // call anything — ORGANIZATIONS_SERVICE_URL points at a default nobody
  // serves here.
  INTERNAL_SERVICE_TOKEN: 'test-internal-0123456789abcdef0123456789',
};

const PASSWORD = 'long-enough-password';

async function buildApp(options: { disableThrottling: boolean }): Promise<{
  app: INestApplication;
  users: InMemoryUserRepository;
}> {
  const env = validateEnv(authServiceEnvSchema, TEST_ENV);
  const users = new InMemoryUserRepository();

  let builder = Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  })
    .overrideProvider(USER_REPOSITORY)
    .useValue(users)
    .overrideProvider(REFRESH_TOKEN_REPOSITORY)
    .useValue(new InMemoryRefreshTokenRepository())
    .overrideProvider(PASSWORD_HASHER)
    .useValue(new FakePasswordHasher())
    // Replacing the adapter keeps the suite broker-free: the real one owns
    // a live AMQP connection.
    .overrideProvider(EVENT_PUBLISHER)
    .useValue(new FakeEventPublisher())
    // Belongs-nowhere, and stated rather than inherited. Until Sprint 10.8
    // this suite got a null resolver for free because the credential was
    // unset in TEST_ENV; the module now always builds a real HTTP one, which
    // would reach for localhost:3010 and turn every login into a 503.
    .overrideProvider(MEMBERSHIP_RESOLVER)
    .useValue(FakeMembershipResolver.resolvingNothing());

  if (options.disableThrottling) {
    builder = builder
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true });
  }

  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication({ logger: false });
  // Mirror main.ts so validation behavior is what production gets.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();

  return { app, users };
}

describe('Auth HTTP API (fakes, no database)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await buildApp({ disableThrottling: true }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('registers, logs in, reads /me, rotates and logs out', async () => {
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'flow@example.com', password: PASSWORD })
      .expect(201);
    expect(register.body).toMatchObject({
      email: 'flow@example.com',
      roles: ['user'],
    });
    expect(register.body).not.toHaveProperty('passwordHash');

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'flow@example.com', password: PASSWORD })
      .expect(200);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.refreshToken).toBeTruthy();
    // The response still names roles; the token no longer does (phase 8).
    // Everything role-shaped a client sees comes from the user row.
    expect(login.body.user).toMatchObject({ roles: ['user'] });
    const claims = app
      .get(JwtService)
      .decode<Record<string, unknown>>(login.body.accessToken);
    expect(claims).not.toHaveProperty('roles');

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body).toMatchObject({
      id: register.body.id,
      email: 'flow@example.com',
      roles: ['user'],
    });

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(204);
  });

  it('rejects invalid registration payloads with 400', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'not-an-email', password: PASSWORD })
      .expect(400);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'short@example.com', password: 'too-short' })
      .expect(400);

    // Unknown fields are rejected, not silently stripped.
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'x@example.com', password: PASSWORD, admin: true })
      .expect(400);
  });

  it('answers 409 for a duplicate email and 401 for bad credentials', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'dup@example.com', password: PASSWORD })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'dup@example.com', password: PASSWORD })
      .expect(409);

    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'dup@example.com', password: 'wrong-password-x' })
      .expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'ghost@example.com', password: 'wrong-password-x' })
      .expect(401);
    // Same message for both failure modes: no account enumeration.
    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
  });

  it('protects /me and rejects reused refresh tokens', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
    await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', 'Bearer not-a-real-token')
      .expect(401);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'reuse@example.com', password: PASSWORD })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'reuse@example.com', password: PASSWORD })
      .expect(200);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    // Replaying the rotated-out token fails and kills the whole family.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });
});

/**
 * The token exchange over HTTP (Sprint 10.6, ADR 0025).
 *
 * The resolver here ANSWERS, unlike the suite above, which overrides it with
 * one that reports belongs-nowhere. Both override it: since Sprint 10.8 the
 * module always builds a real HTTP resolver, so a suite that wants any other
 * behaviour has to say so. Switching organizations is the one flow that
 * cannot be exercised without a resolver that hands out memberships.
 */
describe('Organization exchange HTTP API', () => {
  const ACME = '00000000-0000-4000-8000-0000000000aa';
  const OTHER = '00000000-0000-4000-8000-0000000000bb';
  const THEIRS = '00000000-0000-4000-8000-0000000000cc';

  let app: INestApplication;
  let accessToken: string;

  beforeAll(async () => {
    const env = validateEnv(authServiceEnvSchema, TEST_ENV);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(USER_REPOSITORY)
      .useValue(new InMemoryUserRepository())
      .overrideProvider(REFRESH_TOKEN_REPOSITORY)
      .useValue(new InMemoryRefreshTokenRepository())
      .overrideProvider(PASSWORD_HASHER)
      .useValue(new FakePasswordHasher())
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(new FakeEventPublisher())
      .overrideProvider(MEMBERSHIP_RESOLVER)
      .useValue(
        FakeMembershipResolver.withOrganizations(
          {
            organizationId: ACME,
            permissions: ['tickets.read_own'],
            membershipVersion: 1,
            branchIds: [],
            teamIds: [],
          },
          {
            organizationId: ACME,
            permissions: ['tickets.read_own'],
            membershipVersion: 1,
            branchIds: [],
            teamIds: [],
          },
          {
            organizationId: OTHER,
            permissions: ['tickets.read_all'],
            membershipVersion: 4,
            branchIds: [],
            teamIds: [],
          },
        ),
      )
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'switcher@example.com', password: PASSWORD })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'switcher@example.com', password: PASSWORD })
      .expect(200);
    accessToken = login.body.accessToken;
    expect(login.body.organizationId).toBe(ACME);
  });

  afterAll(async () => {
    await app.close();
  });

  it('swaps the token for one acting in another held organization', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/session/organization')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ organizationId: OTHER })
      .expect(200);

    expect(response.body.organizationId).toBe(OTHER);
    expect(response.body.permissions).toEqual(['tickets.read_all']);
    // No refresh credential: switching context is not starting a session, and
    // the client keeps the one it already has (ADR 0025).
    expect(response.body).not.toHaveProperty('refreshToken');
    expect(response.body).not.toHaveProperty('refreshTokenId');
  });

  it('answers 404 for an organization the caller does not hold', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/session/organization')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ organizationId: THEIRS })
      .expect(404);

    // Blind to which kind of no it is: distinguishing "not yours" from "no
    // such organization" would make this an oracle for what exists.
    expect(response.body.message).toMatch(/not available/i);
  });

  it('answers 401 without a token — the caller is the verified token', async () => {
    await request(app.getHttpServer())
      .post('/auth/session/organization')
      .send({ organizationId: OTHER })
      .expect(401);
  });

  it('refuses a body naming a user: who is asking comes from the token', async () => {
    await request(app.getHttpServer())
      .post('/auth/session/organization')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ organizationId: OTHER, userId: 'somebody-else' })
      .expect(400);
  });

  it.each([
    ['a missing organization', {}],
    ['an organization that is not a uuid', { organizationId: 'acme' }],
    ['an organization that is not a string', { organizationId: 42 }],
  ])('answers 400 for %s', async (_case, body) => {
    await request(app.getHttpServer())
      .post('/auth/session/organization')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(body)
      .expect(400);
  });

  it('resumes a remembered organization on refresh, and falls back when it is gone', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'switcher@example.com', password: PASSWORD })
      .expect(200);

    const resumed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken, organizationId: OTHER })
      .expect(200);
    expect(resumed.body.organizationId).toBe(OTHER);

    // An organization that cannot be honoured falls back rather than failing:
    // a stale client must not be able to sign somebody out.
    const fellBack = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: resumed.body.refreshToken, organizationId: THEIRS })
      .expect(200);
    expect(fellBack.body.organizationId).toBe(ACME);
  });

  it('refuses an organization id on LOGOUT, which shares the other body shape', async () => {
    // `forbidNonWhitelisted` is what keeps the refresh DTO's new field from
    // silently becoming part of every body that looks like it.
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'switcher@example.com', password: PASSWORD })
      .expect(200);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: login.body.refreshToken, organizationId: OTHER })
      .expect(400);
  });
});

describe('Auth throttling', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await buildApp({ disableThrottling: false }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('rate-limits the login endpoint after 5 attempts in a minute', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'brute@example.com', password: 'wrong-password-x' })
        .expect(401);
    }

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'brute@example.com', password: 'wrong-password-x' })
      .expect(429);
  });
});
