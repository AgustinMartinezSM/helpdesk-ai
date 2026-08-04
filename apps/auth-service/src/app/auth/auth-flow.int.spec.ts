import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { MEMBERSHIP_RESOLVER } from '../../application/ports/membership-resolver';
import {
  FakeEventPublisher,
  FakeMembershipResolver,
} from '../../application/testing/fakes';
import { authServiceEnvSchema } from '../../config/env';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppModule } from '../app.module';

// End-to-end over the real stack: argon2, JWT, Prisma against
// helpdesk_auth_test. Throttling is covered by the fast suite and disabled
// here so the flow can exercise more than five credential calls.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run via `nx run @helpdesk-ai/auth-service:test-integration` with the compose postgres service up.',
  );
}

const PASSWORD = 'a-perfectly-fine-password';
const JWT_SECRET = 'integration-secret-0123456789abcdef012345';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a1';
const BRANCH_ID = '00000000-0000-4000-8000-0000000000b1';
const TEAM_ID = '00000000-0000-4000-8000-0000000000c1';

describe('Auth flow (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const env = validateEnv(authServiceEnvSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: databaseUrl,
      RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
      JWT_ACCESS_SECRET: JWT_SECRET,
      // Required since Sprint 10.8. organizations-service does not run in
      // this suite, so the resolver is overridden below — which is the work
      // the handoff said had to come FIRST, before the schema could be
      // tightened: without it, flipping the field turns every login here
      // into a 503.
      INTERNAL_SERVICE_TOKEN: 'integration-internal-0123456789abcdef0123',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      // This suite's focus is the auth flow against real Postgres; the
      // event path against a real broker is covered by libs/messaging and
      // users-service integration suites.
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(new FakeEventPublisher())
      // Answers with a real membership rather than belongs-nowhere, ON
      // PURPOSE. After 10.8 there is no production configuration in which
      // auth mints without asking, so a suite over the real stack should
      // mint what the real stack mints — and it lets the flow below decode
      // the SIGNED token, which is the assertion this repository learned to
      // want the hard way (Sprint 10.6: `tm` was missing from every signed
      // token for four sprints because the tests asserted what a FAKE issuer
      // received).
      .overrideProvider(MEMBERSHIP_RESOLVER)
      .useValue(
        FakeMembershipResolver.resolving({
          organizationId: ORGANIZATION_ID,
          permissions: ['tickets.read_own', 'tickets.read_team'],
          membershipVersion: 7,
          branchIds: [BRANCH_ID],
          teamIds: [TEAM_ID],
        }),
      )
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
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
    await app.close();
  });

  it('runs the full lifecycle: register, login, me, refresh, logout', async () => {
    const register = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'real@example.com', password: PASSWORD })
      .expect(201);

    // The stored hash must be argon2id and never equal the plain password.
    const stored = await prisma.user.findUnique({
      where: { email: 'real@example.com' },
    });
    expect(stored?.passwordHash).toMatch(/^\$argon2id\$/);

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'real@example.com', password: PASSWORD })
      .expect(200);
    expect(login.body.user).toMatchObject({
      id: register.body.id,
      email: 'real@example.com',
    });

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);

    // The tenant claims, VERIFIED off the token this flow actually signed.
    //
    // jwt-token-issuer.spec.ts already decodes a signed token, and Sprint
    // 10.6 added it for a good reason: `tm` was assembled by SessionService
    // from 9.12 and never copied by the issuer, because `AccessTokenClaims`
    // did not declare it and a spread is not an object literal, so
    // TypeScript's excess-property check never fired. Every test on the mint
    // path asserted what a FAKE issuer received, so `tickets.read_team`
    // granted nothing in production for four sprints.
    //
    // What this adds is the other half of that boundary: the issuer spec
    // proves the issuer signs what it is given, and this proves the wired
    // module gives it the resolved membership — over real HTTP, through the
    // real controller, with the signature checked rather than merely decoded.
    const claims = app
      .get(JwtService)
      .verify<Record<string, unknown>>(login.body.accessToken);
    expect(claims).toMatchObject({
      sub: register.body.id,
      org: ORGANIZATION_ID,
      perms: ['tickets.read_own', 'tickets.read_team'],
      mv: 7,
      br: [BRANCH_ID],
      tm: [TEAM_ID],
    });
    // Phase 8 removed this one, and a signed token is where that is true or
    // not — the response body still carries user.roles, which web reads.
    expect(claims.roles).toBeUndefined();

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(login.body.refreshToken);

    await request(app.getHttpServer())
      .post('/auth/logout')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(204);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
  });

  it('detects refresh token reuse and revokes the whole family', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'family@example.com', password: PASSWORD })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'family@example.com', password: PASSWORD })
      .expect(200);
    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);

    // Replay of the rotated-out token: reuse detected.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);

    // The legitimate newest token is dead too, and the database agrees.
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: refreshed.body.refreshToken })
      .expect(401);
    const active = await prisma.refreshToken.count({
      where: { revokedAt: null },
    });
    expect(active).toBe(0);
  });

  it('rejects wrong credentials and duplicate registrations', async () => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'dup-real@example.com', password: PASSWORD })
      .expect(201);

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'dup-real@example.com', password: PASSWORD })
      .expect(409);

    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'dup-real@example.com', password: 'wrong-password-1' })
      .expect(401);
  });
});
