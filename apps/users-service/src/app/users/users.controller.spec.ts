import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { PERMISSIONS } from '@helpdesk-ai/security';
import { FIELD_DEFINITION_REPOSITORY } from '../../application/ports/field-definition.repository';
import { FIELD_VALUE_REPOSITORY } from '../../application/ports/field-value.repository';
import { MEMBERSHIP_PROJECTION_REPOSITORY } from '../../application/ports/membership-projection.repository';
import { USER_PROFILE_REPOSITORY } from '../../application/ports/user-profile.repository';
import { RegisterUserProfileUseCase } from '../../application/use-cases/register-user-profile';
import {
  FixedClock,
  InMemoryFieldDefinitionRepository,
  InMemoryFieldValueRepository,
  InMemoryMembershipProjectionRepository,
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
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('Users HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let memberships: InMemoryMembershipProjectionRepository;
  let profiles: InMemoryUserProfileRepository;
  let definitions: InMemoryFieldDefinitionRepository;
  let values: InMemoryFieldValueRepository;
  let userToken: string;
  let agentToken: string;
  let secondOrgAgentToken: string;
  let tenantlessAgentToken: string;
  let deskManagerToken: string;

  beforeAll(async () => {
    const env = validateEnv(usersServiceEnvSchema, TEST_ENV);
    memberships = new InMemoryMembershipProjectionRepository();
    profiles = new InMemoryUserProfileRepository(memberships);
    definitions = new InMemoryFieldDefinitionRepository();
    values = new InMemoryFieldValueRepository();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(USER_PROFILE_REPOSITORY)
      .useValue(profiles)
      .overrideProvider(MEMBERSHIP_PROJECTION_REPOSITORY)
      .useValue(memberships)
      // The field projections back the org-defined values; in-memory
      // doubles keep the suite database-free.
      .overrideProvider(FIELD_DEFINITION_REPOSITORY)
      .useValue(definitions)
      .overrideProvider(FIELD_VALUE_REPOSITORY)
      .useValue(values)
      // Replacing the client keeps the suite broker-free: the real one owns
      // a live AMQP connection.
      .overrideProvider(MessagingClient)
      .useValue({
        subscribe: async () => undefined,
        publish: async () => undefined,
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
        // Member-shaped, deliberately without people.read.
        perms: [PERMISSIONS.ORGANIZATION_READ],
      },
      { subject: USER_ID },
    );
    agentToken = await jwt.signAsync(
      {
        email: 'agent@example.com',
        org: ORG_A,
        perms: [PERMISSIONS.PEOPLE_READ],
      },
      { subject: AGENT_ID },
    );
    // Same permission, different tenant: must see a different directory.
    secondOrgAgentToken = await jwt.signAsync(
      {
        email: 'rival-agent@example.com',
        org: ORG_B,
        perms: [PERMISSIONS.PEOPLE_READ],
      },
      { subject: '44444444-4444-4444-8444-444444444444' },
    );
    // people.read but no org claim: the token of an account that belongs
    // nowhere yet. The shared NoOrganizationContextError must surface as 403.
    tenantlessAgentToken = await jwt.signAsync(
      {
        email: 'floating-agent@example.com',
        perms: [PERMISSIONS.PEOPLE_READ],
      },
      { subject: '55555555-5555-4555-8555-555555555555' },
    );
    // The narrow key ALONE (Sprint 9.14): enough to name a candidate for a
    // support team, and nothing else on this controller.
    deskManagerToken = await jwt.signAsync(
      {
        email: 'desk@example.com',
        org: ORG_A,
        perms: [PERMISSIONS.PEOPLE_READ_ASSIGNABLE],
      },
      { subject: '66666666-6666-4666-8666-666666666666' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function asBearer(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function project(userId: string, email: string) {
    await new RegisterUserProfileUseCase(
      profiles,
      new FixedClock(new Date('2026-07-28T12:00:05.000Z')),
    ).execute({
      userId,
      email,
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

    await project(USER_ID, 'ada@example.com');

    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set(asBearer(userToken))
      .expect(200);

    expect(response.body).toEqual({
      userId: USER_ID,
      email: 'ada@example.com',
      displayName: 'ada',
      preferredName: null,
      phone: null,
      language: null,
      timezone: null,
      registeredAt: '2026-07-28T12:00:00.000Z',
      // Tenantless token: person profile only, no org fields to show.
      fields: [],
    });
  });

  it('restricts the directory to people.read holders in an organization', async () => {
    await project(AGENT_ID, 'agent@example.com');
    for (const userId of [USER_ID, AGENT_ID]) {
      await memberships.applyCreated({
        organizationId: ORG_A,
        userId,
        roleTemplate: 'agent',
        status: 'active',
        occurredAt: new Date('2026-07-28T12:00:01.000Z'),
      });
    }

    await request(app.getHttpServer())
      .get('/users')
      .set(asBearer(userToken))
      .expect(403);

    await request(app.getHttpServer())
      .get('/users')
      .set(asBearer(tenantlessAgentToken))
      .expect(403);

    const response = await request(app.getHttpServer())
      .get('/users')
      .set(asBearer(agentToken))
      .expect(200);

    expect(
      response.body.map((profile: { userId: string }) => profile.userId),
    ).toEqual(expect.arrayContaining([USER_ID, AGENT_ID]));
  });

  it('shows another organization an empty directory, not a filtered one', async () => {
    const response = await request(app.getHttpServer())
      .get('/users')
      .set(asBearer(secondOrgAgentToken))
      .expect(200);

    expect(response.body).toEqual([]);
  });

  describe('membership status filter (Sprint 9.10)', () => {
    async function withSuspendedColleague() {
      await project(USER_ID, 'ada@example.com');
      await project(AGENT_ID, 'agent@example.com');
      await memberships.applyCreated({
        organizationId: ORG_A,
        userId: AGENT_ID,
        roleTemplate: 'agent',
        status: 'active',
        occurredAt: new Date('2026-07-28T12:00:01.000Z'),
      });
      await memberships.applyCreated({
        organizationId: ORG_A,
        userId: USER_ID,
        roleTemplate: 'requester',
        status: 'suspended',
        occurredAt: new Date('2026-07-28T12:00:01.000Z'),
      });
    }

    it('defaults to active members, which is what pickers depend on', async () => {
      await withSuspendedColleague();

      const response = await request(app.getHttpServer())
        .get('/users')
        .set(asBearer(agentToken))
        .expect(200);

      // The default has to keep meaning what it meant before this sprint:
      // an assignee picker must not start offering suspended people because
      // a management screen needed to see them.
      expect(
        response.body.map((profile: { userId: string }) => profile.userId),
      ).toEqual([AGENT_ID]);
      expect(response.body[0].status).toBe('active');
    });

    it('includes everyone on ?status=all', async () => {
      await withSuspendedColleague();

      const response = await request(app.getHttpServer())
        .get('/users?status=all')
        .set(asBearer(agentToken))
        .expect(200);

      const byUser = new Map(
        response.body.map((profile: { userId: string; status: string }) => [
          profile.userId,
          profile.status,
        ]),
      );
      expect(byUser.get(USER_ID)).toBe('suspended');
      expect(byUser.get(AGENT_ID)).toBe('active');
    });

    it('narrows to one named status', async () => {
      await withSuspendedColleague();

      const response = await request(app.getHttpServer())
        .get('/users?status=suspended')
        .set(asBearer(agentToken))
        .expect(200);

      expect(
        response.body.map((profile: { userId: string }) => profile.userId),
      ).toEqual([USER_ID]);
    });

    it('refuses a status it does not know rather than ignoring it', async () => {
      // Falling back to the default would answer a narrower question than
      // the one asked, and the caller would have no way to tell.
      await request(app.getHttpServer())
        .get('/users?status=paused')
        .set(asBearer(agentToken))
        .expect(400);
    });

    it('still needs people.read, whatever the filter says', async () => {
      await request(app.getHttpServer())
        .get('/users?status=all')
        .set(asBearer(userToken))
        .expect(403);
    });
  });

  /**
   * Over HTTP, through the real guard, the real pipe and the real exception
   * filter — the lesson Sprint 9.13 paid for twice, where a rule that was
   * correct at the use case answered 400 and 500 at the boundary.
   */
  describe('the candidate list (Sprint 9.14)', () => {
    it("wins over ':userId' — the literal route, not a malformed id", async () => {
      // If 'assignable' were captured by @Get(':userId'), the UUID pipe would
      // answer 400 here instead of the listing's 200.
      const response = await request(app.getHttpServer())
        .get('/users/assignable')
        .set(asBearer(deskManagerToken))
        .expect(200);

      expect(Array.isArray(response.body)).toBe(true);
    });

    it('answers the narrow key and returns three fields', async () => {
      const response = await request(app.getHttpServer())
        .get('/users/assignable')
        .set(asBearer(deskManagerToken))
        .expect(200);

      for (const candidate of response.body) {
        expect(Object.keys(candidate).sort()).toEqual([
          'email',
          'name',
          'userId',
        ]);
      }
    });

    it('refuses the same token everywhere else on this controller', async () => {
      // The narrowing, proved at the boundary: holding people.read_assignable
      // opens the candidate list and nothing adjacent to it.
      await request(app.getHttpServer())
        .get('/users')
        .set(asBearer(deskManagerToken))
        .expect(403);
      await request(app.getHttpServer())
        .get(`/users/${USER_ID}`)
        .set(asBearer(deskManagerToken))
        .expect(403);
    });

    it('refuses a member holding neither key (required case 3)', async () => {
      await request(app.getHttpServer())
        .get('/users/assignable')
        .set(asBearer(userToken))
        .expect(403);
    });

    it('answers a people.read holder too', async () => {
      await request(app.getHttpServer())
        .get('/users/assignable')
        .set(asBearer(agentToken))
        .expect(200);
    });
  });
});
