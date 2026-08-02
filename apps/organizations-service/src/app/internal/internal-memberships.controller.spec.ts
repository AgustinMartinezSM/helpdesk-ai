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
import {
  FakeOrganizationEventPublisher,
  InMemoryBranchMembershipRepository,
  InMemoryBranchRepository,
  InMemoryDepartmentRepository,
  InMemoryMembershipRepository,
  InMemoryOperationalStationRepository,
  InMemoryOrganizationRepository,
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
    await request(app.getHttpServer())
      .patch(
        `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/status`,
      )
      .send({ status: 'suspended' })
      .expect(401);

    // Rejected before the handler ran: nothing changed, nothing published.
    expect(memberships.memberships[0].status).toBe('active');
    expect(events.statusChanged).toHaveLength(0);
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

  it('changes a status through the lifecycle endpoint and stops resolution', async () => {
    memberships.memberships.push(membership());

    const changed = await request(app.getHttpServer())
      .patch(
        `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/status`,
      )
      .set(asService())
      .send({ status: 'suspended' })
      .expect(200);

    expect(changed.body).toEqual({ status: 'suspended', version: 2 });
    expect(events.statusChanged).toHaveLength(1);
    expect(events.statusChanged[0].fromStatus).toBe('active');

    // The suspension is immediately visible to the mint-time resolution:
    // the next token this user gets carries no organization.
    const resolved = await request(app.getHttpServer())
      .get(`/internal/memberships/${USER_ID}/active`)
      .set(asService())
      .expect(200);
    expect(resolved.body).toEqual({
      organizationId: null,
      permissions: [],
      membershipVersion: null,
      // Frozen shape: even the no-membership answer carries the empty
      // array, because auth-service parses exactly `branchIds: string[]`.
      branchIds: [],
    });
  });

  it('answers 409 for a transition the table refuses', async () => {
    memberships.memberships.push(membership({ status: 'deactivated' }));

    await request(app.getHttpServer())
      .patch(
        `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/status`,
      )
      .set(asService())
      .send({ status: 'active' })
      .expect(409);
    expect(events.statusChanged).toHaveLength(0);
  });

  it('answers 404 when changing a status for a user with no membership', async () => {
    await request(app.getHttpServer())
      .patch(
        `/internal/organizations/${ORGANIZATION_ID}/memberships/${UNKNOWN_USER_ID}/status`,
      )
      .set(asService())
      .send({ status: 'suspended' })
      .expect(404);
  });

  it('answers 400 for a word that is not a status', async () => {
    memberships.memberships.push(membership());

    await request(app.getHttpServer())
      .patch(
        `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/status`,
      )
      .set(asService())
      .send({ status: 'paused' })
      .expect(400);
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
    expect(new Set(response.body.permissions)).toEqual(
      permissionsForTemplate('agent'),
    );
  });

  describe('structure surface', () => {
    it('rejects every structure route without the service credential', async () => {
      await request(app.getHttpServer())
        .post(`/internal/organizations/${ORGANIZATION_ID}/branches`)
        .send({ code: 'store-12', name: 'Store 12' })
        .expect(401);
      await request(app.getHttpServer())
        .patch(
          `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/role`,
        )
        .send({ roleTemplate: 'branch_manager' })
        .expect(401);

      expect(branches.branches).toHaveLength(0);
      expect(events.branchesCreated).toHaveLength(0);
    });

    async function createBranch(code = 'store-12') {
      const response = await request(app.getHttpServer())
        .post(`/internal/organizations/${ORGANIZATION_ID}/branches`)
        .set(asService())
        .send({ code, name: `Branch ${code}`, timezone: 'UTC' })
        .expect(201);
      return response.body as { branchId: string };
    }

    it('creates a branch, publishes it, and answers 409 on the duplicate code', async () => {
      const created = await createBranch();

      expect(created.branchId).toBeDefined();
      expect(events.branchesCreated).toHaveLength(1);

      await request(app.getHttpServer())
        .post(`/internal/organizations/${ORGANIZATION_ID}/branches`)
        .set(asService())
        .send({ code: 'store-12', name: 'Another' })
        .expect(409);
      expect(events.branchesCreated).toHaveLength(1);
    });

    it('archives a branch through PATCH and publishes the update', async () => {
      const created = await createBranch();

      const archived = await request(app.getHttpServer())
        .patch(
          `/internal/organizations/${ORGANIZATION_ID}/branches/${created.branchId}`,
        )
        .set(asService())
        .send({ status: 'archived' })
        .expect(200);

      expect(archived.body.status).toBe('archived');
      expect(events.branchesUpdated).toHaveLength(1);
    });

    it('answers 400 for a word that is not a branch status', async () => {
      const created = await createBranch();

      await request(app.getHttpServer())
        .patch(
          `/internal/organizations/${ORGANIZATION_ID}/branches/${created.branchId}`,
        )
        .set(asService())
        .send({ status: 'closed' })
        .expect(400);
    });

    it('answers 404 for a branch of another organization', async () => {
      const created = await createBranch();
      const OTHER_ORG = '33333333-3333-4333-8333-333333333333';

      // Foreign and nonexistent must be the same 404: confirming existence
      // is the leak.
      await request(app.getHttpServer())
        .patch(
          `/internal/organizations/${OTHER_ORG}/branches/${created.branchId}`,
        )
        .set(asService())
        .send({ name: 'Probe' })
        .expect(404);
      expect(events.branchesUpdated).toHaveLength(0);
    });

    it('creates departments and stations under the branch', async () => {
      const created = await createBranch();

      await request(app.getHttpServer())
        .post(
          `/internal/organizations/${ORGANIZATION_ID}/branches/${created.branchId}/departments`,
        )
        .set(asService())
        .send({ name: 'Electronics' })
        .expect(201);

      const station = await request(app.getHttpServer())
        .post(
          `/internal/organizations/${ORGANIZATION_ID}/branches/${created.branchId}/stations`,
        )
        .set(asService())
        .send({ code: 'cashier-2', name: 'Cashier station 2' })
        .expect(201);

      // Stations announce themselves (tickets-service projects them);
      // departments stay silent (no consumer exists).
      expect(events.stationsCreated).toHaveLength(1);
      expect(station.body.stationId).toBeDefined();

      await request(app.getHttpServer())
        .patch(
          `/internal/organizations/${ORGANIZATION_ID}/stations/${station.body.stationId}`,
        )
        .set(asService())
        .send({ status: 'archived' })
        .expect(200);
      expect(events.stationsUpdated).toHaveLength(1);
    });

    it('assigns and removes a branch idempotently, reflected in resolution', async () => {
      memberships.memberships.push(membership());
      const created = await createBranch();
      const edge = `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/branches/${created.branchId}`;

      await request(app.getHttpServer()).put(edge).set(asService()).expect(204);
      // Idempotent: the second PUT converges on the same edge.
      await request(app.getHttpServer()).put(edge).set(asService()).expect(204);
      expect(branchMemberships.edges).toHaveLength(1);

      const resolved = await request(app.getHttpServer())
        .get(`/internal/memberships/${USER_ID}/active`)
        .set(asService())
        .expect(200);
      expect(resolved.body.branchIds).toEqual([created.branchId]);

      await request(app.getHttpServer())
        .delete(edge)
        .set(asService())
        .expect(204);
      await request(app.getHttpServer())
        .delete(edge)
        .set(asService())
        .expect(204);
      expect(branchMemberships.edges).toHaveLength(0);
    });

    it('changes a role template, bumps the version, and refuses the self-loop', async () => {
      memberships.memberships.push(membership());

      const changed = await request(app.getHttpServer())
        .patch(
          `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/role`,
        )
        .set(asService())
        .send({ roleTemplate: 'branch_manager' })
        .expect(200);

      expect(changed.body).toEqual({
        roleTemplate: 'branch_manager',
        version: 2,
      });
      expect(events.roleChanged).toHaveLength(1);
      expect(events.roleChanged[0].fromTemplate).toBe('agent');

      // "Already there" is a stale caller, not a success (409), and must
      // not bump the version over a non-change.
      await request(app.getHttpServer())
        .patch(
          `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/role`,
        )
        .set(asService())
        .send({ roleTemplate: 'branch_manager' })
        .expect(409);
      expect(memberships.memberships[0].version).toBe(2);
    });

    it('answers 400 for a word that is not a role template', async () => {
      memberships.memberships.push(membership());

      await request(app.getHttpServer())
        .patch(
          `/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}/role`,
        )
        .set(asService())
        .send({ roleTemplate: 'superuser' })
        .expect(400);
      expect(events.roleChanged).toHaveLength(0);
    });
  });
});
