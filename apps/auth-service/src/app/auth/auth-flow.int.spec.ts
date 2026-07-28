import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { FakeEventPublisher } from '../../application/testing/fakes';
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

describe('Auth flow (real database)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const env = validateEnv(authServiceEnvSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      DATABASE_URL: databaseUrl,
      RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
      JWT_ACCESS_SECRET: 'integration-secret-0123456789abcdef012345',
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
