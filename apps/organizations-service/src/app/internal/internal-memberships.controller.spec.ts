import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { MEMBERSHIP_REPOSITORY } from '../../application/ports/membership.repository';
import { ORGANIZATION_REPOSITORY } from '../../application/ports/organization.repository';
import {
  BRANCH_MEMBERSHIP_REPOSITORY,
  BRANCH_REPOSITORY,
  DEPARTMENT_REPOSITORY,
  STATION_REPOSITORY,
} from '../../application/ports/structure.repository';
import { SUPPORT_TEAM_REPOSITORY } from '../../application/ports/support-team.repository';
import {
  FakeOrganizationEventPublisher,
  InMemoryBranchMembershipRepository,
  InMemoryBranchRepository,
  InMemoryDepartmentRepository,
  InMemoryMembershipRepository,
  InMemoryOperationalStationRepository,
  InMemoryOrganizationRepository,
  InMemorySupportTeamRepository,
} from '../../application/testing/fakes';
import { permissionsForTemplate } from '../../domain/permissions';
import type { Membership } from '../../domain/membership';
import { organizationsServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';
import { INTERNAL_SERVICE_TOKEN_HEADER } from './internal-service.guard';

const INTERNAL_TOKEN = 'internal-test-token-0123456789abcdef0123456789';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  INTERNAL_SERVICE_TOKEN: INTERNAL_TOKEN,
  // Required since Sprint 9.8 gave the service a person-facing surface. The
  // internal routes below verify no access token, but the module registers
  // JwtModule for the ones that do.
  JWT_ACCESS_SECRET: 'jwt-test-secret-0123456789abcdef0123456789',
};

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_USER_ID = '22222222-2222-4222-8222-222222222222';
const BRANCH_ID = '00000000-0000-4000-8000-0000000000bb';

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    roleTemplate: 'agent',
    status: 'active',
    version: 1,
    createdAt: new Date('2026-07-30T12:00:00.000Z'),
    updatedAt: new Date('2026-07-30T12:00:00.000Z'),
    ...overrides,
  };
}

describe('Internal membership HTTP surface (fakes, real guard)', () => {
  let app: INestApplication;
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const branches = new InMemoryBranchRepository();
  const departments = new InMemoryDepartmentRepository();
  const stations = new InMemoryOperationalStationRepository();
  const branchMemberships = new InMemoryBranchMembershipRepository();
  const supportTeams = new InMemorySupportTeamRepository();
  const events = new FakeOrganizationEventPublisher();

  beforeAll(async () => {
    const env = validateEnv(organizationsServiceEnvSchema, TEST_ENV);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(ORGANIZATION_REPOSITORY)
      .useValue(organizations)
      .overrideProvider(MEMBERSHIP_REPOSITORY)
      .useValue(memberships)
      .overrideProvider(BRANCH_REPOSITORY)
      .useValue(branches)
      .overrideProvider(DEPARTMENT_REPOSITORY)
      .useValue(departments)
      .overrideProvider(STATION_REPOSITORY)
      .useValue(stations)
      .overrideProvider(BRANCH_MEMBERSHIP_REPOSITORY)
      .useValue(branchMemberships)
      .overrideProvider(SUPPORT_TEAM_REPOSITORY)
      .useValue(supportTeams)
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(events)
      // Replacing the client keeps the suite broker-free: the real one owns
      // a live AMQP connection, and the registration consumer subscribes on
      // bootstrap.
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

    organizations.add({
      id: ORGANIZATION_ID,
      slug: 'bootstrap',
      name: 'Bootstrap organization',
      status: 'active',
      createdAt: new Date('2026-07-30T00:00:00.000Z'),
      updatedAt: new Date('2026-07-30T00:00:00.000Z'),
    });
  });

  beforeEach(() => {
    memberships.memberships.length = 0;
    branches.branches.length = 0;
    departments.departments.length = 0;
    stations.stations.length = 0;
    branchMemberships.edges.length = 0;
    events.statusChanged.length = 0;
    events.roleChanged.length = 0;
    events.branchesCreated.length = 0;
    events.branchesUpdated.length = 0;
    events.stationsCreated.length = 0;
    events.stationsUpdated.length = 0;
  });

  afterAll(async () => {
    await app.close();
  });

  function asService() {
    return { [INTERNAL_SERVICE_TOKEN_HEADER]: INTERNAL_TOKEN };
  }

  it('rejects every route without the service credential', async () => {
    memberships.memberships.push(membership());

    await request(app.getHttpServer())
      .get(`/internal/memberships/${USER_ID}/active`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}`)
      .expect(401);
  });

  it('no longer exposes the membership lifecycle here', async () => {
    // Sprint 9.10 moved these to `organizations/memberships`, behind a
    // person's token, and DELETED them here rather than deprecating them:
    // an unattributable write path kept for emergencies is the one that gets
    // used (ADR 0016). A 404 with the credential present is the proof — the
    // guard passed and there was no route.
    memberships.memberships.push(membership());
    const base = `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}`;

    await request(app.getHttpServer())
      .patch(`${base}/status`)
      .set(asService())
      .send({ status: 'suspended' })
      .expect(404);
    await request(app.getHttpServer())
      .patch(`${base}/role`)
      .set(asService())
      .send({ roleTemplate: 'branch_manager' })
      .expect(404);
    await request(app.getHttpServer())
      .put(`${base}/branches/00000000-0000-4000-8000-0000000000bb`)
      .set(asService())
      .expect(404);

    expect(memberships.memberships[0].status).toBe('active');
    expect(events.statusChanged).toHaveLength(0);
    expect(events.roleChanged).toHaveLength(0);
  });

  it('reports a membership with its template permissions and organization status', async () => {
    memberships.memberships.push(membership());

    const response = await request(app.getHttpServer())
      .get(`/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}`)
      .set(asService())
      .expect(200);

    expect(response.body).toEqual({
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      status: 'active',
      roleTemplate: 'agent',
      permissions: expect.arrayContaining([...permissionsForTemplate('agent')]),
      membershipVersion: 1,
      organizationStatus: 'active',
      branchIds: [],
    });
  });

  it('keeps reporting permissions for a suspended membership', async () => {
    memberships.memberships.push(membership({ status: 'suspended' }));

    const response = await request(app.getHttpServer())
      .get(`/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}`)
      .set(asService())
      .expect(200);

    // The caller decides what "suspended" means for its operation; this
    // endpoint reports standing, it does not rule on access.
    expect(response.body.status).toBe('suspended');
    expect(response.body.permissions).not.toHaveLength(0);
  });

  it('answers 404 for a pair with no membership row', async () => {
    await request(app.getHttpServer())
      .get(
        `/internal/organizations/${ORGANIZATION_ID}/memberships/${UNKNOWN_USER_ID}`,
      )
      .set(asService())
      .expect(404);
  });

  it('stops resolving a suspended membership', async () => {
    memberships.memberships.push(membership({ status: 'suspended' }));

    // The next token this user gets carries no organization at all.
    const resolved = await request(app.getHttpServer())
      .get(`/internal/memberships/${USER_ID}/active`)
      .set(asService())
      .expect(200);
    expect(resolved.body).toEqual({
      organizationId: null,
      permissions: [],
      membershipVersion: null,
      // Frozen shape: even the no-membership answer carries the empty
      // arrays, because auth-service parses exactly these names.
      branchIds: [],
      teamIds: [],
    });
  });

  it('resolves an active membership with its template permissions', async () => {
    memberships.memberships.push(membership());

    const response = await request(app.getHttpServer())
      .get(`/internal/memberships/${USER_ID}/active`)
      .set(asService())
      .expect(200);

    expect(response.body.organizationId).toBe(ORGANIZATION_ID);
    expect(response.body.membershipVersion).toBe(1);
    expect(response.body.branchIds).toEqual([]);
    expect(response.body.teamIds).toEqual([]);
    expect(new Set(response.body.permissions)).toEqual(
      permissionsForTemplate('agent'),
    );
  });

  describe('structure surface', () => {
    it('no longer exposes structure here either', async () => {
      // Sprint 9.11 finished what 9.10 started. With the credential present
      // and correct these answer 404: the guard passed and there is no route.
      // INTERNAL_SERVICE_TOKEN now guards no mutation anywhere in the
      // platform — what is left behind it is the two reads above.
      const base = `/internal/organizations/${ORGANIZATION_ID}`;

      await request(app.getHttpServer())
        .post(`${base}/branches`)
        .set(asService())
        .send({ code: 'store-12', name: 'Store 12' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`${base}/branches/${BRANCH_ID}`)
        .set(asService())
        .send({ name: 'Store 12' })
        .expect(404);
      await request(app.getHttpServer())
        .post(`${base}/branches/${BRANCH_ID}/stations`)
        .set(asService())
        .send({ code: 'cashier-2', name: 'Cashier station 2' })
        .expect(404);

      expect(branches.branches).toHaveLength(0);
      expect(events.branchesCreated).toHaveLength(0);
    });

    it('still surfaces a covered branch in the resolution branch set', async () => {
      // The rows are written through the person-facing surface now; what
      // this asserts is that mint-time resolution still reads the edge,
      // which is the only reason the table exists.
      memberships.memberships.push(membership());
      branches.branches.push({
        id: BRANCH_ID,
        organizationId: ORGANIZATION_ID,
        code: 'store-12',
        name: 'Store 12',
        status: 'active',
        timezone: null,
        address: null,
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
        updatedAt: new Date('2026-08-01T12:00:00.000Z'),
      });
      await branchMemberships.assign({
        membershipId: membership().id,
        branchId: BRANCH_ID,
        createdAt: new Date('2026-08-01T12:00:00.000Z'),
      });

      const resolved = await request(app.getHttpServer())
        .get(`/internal/memberships/${USER_ID}/active`)
        .set(asService())
        .expect(200);
      expect(resolved.body.branchIds).toEqual([BRANCH_ID]);
    });
  });
});
