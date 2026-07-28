import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { PASSWORD_HASHER } from '../../application/ports/password-hasher';
import { REFRESH_TOKEN_REPOSITORY } from '../../application/ports/refresh-token.repository';
import { USER_REPOSITORY } from '../../application/ports/user.repository';
import {
  FakeEventPublisher,
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
    .useValue(new FakeEventPublisher());

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
