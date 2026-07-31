import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { PERMISSIONS } from '@helpdesk-ai/security';
import { USER_PROFILE_REPOSITORY } from '../../application/ports/user-profile.repository';
import { RegisterUserProfileUseCase } from '../../application/use-cases/register-user-profile';
import {
  FixedClock,
  InMemoryUserProfileRepository,
} from '../../application/testing/fakes';
import { usersServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
};

const USER_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_ID = '33333333-3333-4333-8333-333333333333';

describe('Users HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let profiles: InMemoryUserProfileRepository;
  let userToken: string;
  let agentToken: string;

  beforeAll(async () => {
    const env = validateEnv(usersServiceEnvSchema, TEST_ENV);
    profiles = new InMemoryUserProfileRepository();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(USER_PROFILE_REPOSITORY)
      .useValue(profiles)
      // Replacing the client keeps the suite broker-free: the real one owns
      // a live AMQP connection.
      .overrideProvider(MessagingClient)
      .useValue({
        subscribe: async () => undefined,
        close: async () => undefined,
      })
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

    const jwt = app.get(JwtService);
    userToken = await jwt.signAsync(
      {
        email: 'ada@example.com',
        roles: ['user'],
        // Member-shaped, deliberately without people.read.
        perms: [PERMISSIONS.ORGANIZATION_READ],
      },
      { subject: USER_ID },
    );
    agentToken = await jwt.signAsync(
      {
        email: 'agent@example.com',
        roles: ['agent'],
        perms: [PERMISSIONS.PEOPLE_READ],
      },
      { subject: AGENT_ID },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function asBearer(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function project(userId: string, email: string, roles: string[]) {
    await new RegisterUserProfileUseCase(
      profiles,
      new FixedClock(new Date('2026-07-28T12:00:05.000Z')),
    ).execute({
      userId,
      email,
      roles,
      registeredAt: new Date('2026-07-28T12:00:00.000Z'),
    });
  }

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/users/me').expect(401);
    await request(app.getHttpServer())
      .get('/users')
      .set('authorization', 'Bearer forged')
      .expect(401);
  });

  it('serves the own profile once projected, 404 before', async () => {
    await request(app.getHttpServer())
      .get('/users/me')
      .set(asBearer(userToken))
      .expect(404);

    await project(USER_ID, 'ada@example.com', ['user']);

    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set(asBearer(userToken))
      .expect(200);

    expect(response.body).toEqual({
      userId: USER_ID,
      email: 'ada@example.com',
      displayName: 'ada',
      roles: ['user'],
      registeredAt: '2026-07-28T12:00:00.000Z',
    });
  });

  it('restricts the directory to people.read holders', async () => {
    await project(AGENT_ID, 'agent@example.com', ['agent']);

    await request(app.getHttpServer())
      .get('/users')
      .set(asBearer(userToken))
      .expect(403);

    const response = await request(app.getHttpServer())
      .get('/users')
      .set(asBearer(agentToken))
      .expect(200);

    expect(
      response.body.map((profile: { userId: string }) => profile.userId),
    ).toEqual(expect.arrayContaining([USER_ID, AGENT_ID]));
  });
});
