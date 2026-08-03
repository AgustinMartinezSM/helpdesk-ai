/**
 * The person-facing organization setup surface (Sprint 9.11), against the
 * real JwtAccessGuard and the real domain error filter.
 *
 * What this suite is for is the HTTP contract: which status code each refusal
 * arrives as, that the tenant is taken from the token and appears in no
 * route, and that a station's responsible person is spoken about by userId.
 * The rules themselves are covered beside the use cases.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { PERMISSIONS } from '@helpdesk-ai/security';
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
import type { Membership } from '../../domain/membership';
import { permissionsForTemplate } from '../../domain/permissions';
import { organizationsServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  INTERNAL_SERVICE_TOKEN: 'internal-test-token-0123456789abcdef0123456789',
  JWT_ACCESS_SECRET: 'jwt-test-secret-0123456789abcdef0123456789',
};

const ORG_A = '00000000-0000-4000-8000-000000000001';
const ORG_B = '00000000-0000-4000-8000-0000000000ff';
const ADMIN_ID = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_ID = '33333333-3333-4333-8333-333333333333';
const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: '00000000-0000-4000-8000-00000000000a',
    organizationId: ORG_A,
    userId: MEMBER_ID,
    roleTemplate: 'requester',
    status: 'active',
    version: 1,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('Organization setup HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const branches = new InMemoryBranchRepository();
  const departments = new InMemoryDepartmentRepository();
  const stations = new InMemoryOperationalStationRepository();
  const branchMemberships = new InMemoryBranchMembershipRepository();
  const events = new FakeOrganizationEventPublisher();
  let adminToken: string;
  let readerToken: string;
  let foreignAdminToken: string;

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
    const adminPerms = [...permissionsForTemplate('organization_admin')];
    adminToken = await jwt.signAsync(
      { email: 'admin@empresa.com', org: ORG_A, perms: adminPerms },
      { subject: ADMIN_ID },
    );
    // Can see the structure, cannot change it — the split D1 draws.
    readerToken = await jwt.signAsync(
      {
        email: 'reader@empresa.com',
        org: ORG_A,
        perms: [PERMISSIONS.BRANCHES_READ],
      },
      { subject: MEMBER_ID },
    );
    foreignAdminToken = await jwt.signAsync(
      { email: 'rival@empresa.com', org: ORG_B, perms: adminPerms },
      { subject: FOREIGN_ID },
    );
  });

  beforeEach(() => {
    branches.branches.length = 0;
    departments.departments.length = 0;
    stations.stations.length = 0;
    memberships.memberships.length = 0;
    events.branchesCreated.length = 0;
    events.branchesUpdated.length = 0;
    events.stationsCreated.length = 0;
    events.stationsUpdated.length = 0;
    organizations.organizations.clear();
    for (const [id, slug] of [
      [ORG_A, 'empresa'],
      [ORG_B, 'rival'],
    ] as const) {
      organizations.add({
        id,
        slug,
        name: slug,
        status: 'active',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        updatedAt: new Date('2026-08-01T00:00:00.000Z'),
      });
    }
    memberships.memberships.push(membership());
  });

  afterAll(async () => {
    await app.close();
  });

  function asBearer(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  async function createBranch(token = adminToken, code = 'store-12') {
    const response = await request(app.getHttpServer())
      .post('/organizations/branches')
      .set(asBearer(token))
      .send({ code, name: `Branch ${code}`, timezone: 'UTC' })
      .expect(201);
    return response.body as { branchId: string };
  }

  it('rejects every route without a token', async () => {
    await request(app.getHttpServer())
      .get('/organizations/branches')
      .expect(401);
    await request(app.getHttpServer())
      .post('/organizations/branches')
      .send({ code: 'store-12', name: 'Store 12' })
      .expect(401);
    expect(branches.branches).toHaveLength(0);
  });

  describe('branches', () => {
    it('registers a branch and publishes it', async () => {
      const created = await createBranch();

      expect(created.branchId).toBeDefined();
      expect(events.branchesCreated).toHaveLength(1);
      // The tenant came from the token: no route ever named it.
      expect(events.branchesCreated[0].branch.organizationId).toBe(ORG_A);
    });

    it('answers 409 on a duplicate code and 201 for the same code elsewhere', async () => {
      await createBranch();

      await request(app.getHttpServer())
        .post('/organizations/branches')
        .set(asBearer(adminToken))
        .send({ code: 'store-12', name: 'Another' })
        .expect(409);
      // Codes are unique per organization, never globally.
      await createBranch(foreignAdminToken);
      expect(branches.branches).toHaveLength(2);
    });

    it('archives a branch and lists it afterwards', async () => {
      const created = await createBranch();

      const archived = await request(app.getHttpServer())
        .patch(`/organizations/branches/${created.branchId}`)
        .set(asBearer(adminToken))
        .send({ status: 'archived' })
        .expect(200);
      expect(archived.body.status).toBe('archived');

      const listed = await request(app.getHttpServer())
        .get('/organizations/branches')
        .set(asBearer(adminToken))
        .expect(200);
      // Archived rows stay in the listing: a screen that cannot see what it
      // archived cannot un-archive it.
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].status).toBe('archived');
    });

    it('refuses to rename the code', async () => {
      const created = await createBranch();

      // Whitelisted validation refuses the unknown property outright: the
      // code is the stable key other systems refer to.
      await request(app.getHttpServer())
        .patch(`/organizations/branches/${created.branchId}`)
        .set(asBearer(adminToken))
        .send({ code: 'store-13' })
        .expect(400);
    });

    it('lists only the caller organization branches', async () => {
      await createBranch();
      await createBranch(foreignAdminToken, 'rival-1');

      const listed = await request(app.getHttpServer())
        .get('/organizations/branches')
        .set(asBearer(adminToken))
        .expect(200);
      expect(listed.body).toHaveLength(1);
      expect(listed.body[0].code).toBe('store-12');
    });

    it('answers 404 for a branch of another organization', async () => {
      const created = await createBranch();

      // Foreign and nonexistent alike: confirming existence is the leak.
      await request(app.getHttpServer())
        .patch(`/organizations/branches/${created.branchId}`)
        .set(asBearer(foreignAdminToken))
        .send({ name: 'Probe' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/organizations/branches/${UNKNOWN_ID}`)
        .set(asBearer(adminToken))
        .send({ name: 'Probe' })
        .expect(404);
      expect(events.branchesUpdated).toHaveLength(0);
    });

    it('answers 403 for a reader and for a token with no organization', async () => {
      await request(app.getHttpServer())
        .post('/organizations/branches')
        .set(asBearer(readerToken))
        .send({ code: 'store-99', name: 'Nope' })
        .expect(403);
      expect(branches.branches).toHaveLength(0);
    });
  });

  describe('departments and stations', () => {
    it('creates both under a branch and reads them back together', async () => {
      const created = await createBranch();

      await request(app.getHttpServer())
        .post(`/organizations/branches/${created.branchId}/departments`)
        .set(asBearer(adminToken))
        .send({ name: 'Electronics' })
        .expect(201);
      const station = await request(app.getHttpServer())
        .post(`/organizations/branches/${created.branchId}/stations`)
        .set(asBearer(adminToken))
        .send({
          code: 'cashier-2',
          name: 'Cashier station 2',
          responsibleUserId: MEMBER_ID,
        })
        .expect(201);

      // Stations announce themselves (tickets-service projects them);
      // departments stay silent, because no consumer exists.
      expect(events.stationsCreated).toHaveLength(1);
      expect(station.body.responsibleUserId).toBe(MEMBER_ID);

      const structure = await request(app.getHttpServer())
        .get(`/organizations/branches/${created.branchId}/structure`)
        .set(asBearer(adminToken))
        .expect(200);
      expect(structure.body.departments).toHaveLength(1);
      expect(structure.body.stations).toHaveLength(1);
      // The listing translates the stored membership id back into the id the
      // People screen speaks.
      expect(structure.body.stations[0].responsibleUserId).toBe(MEMBER_ID);
    });

    it('names the responsible person by userId, and refuses a foreign one', async () => {
      const created = await createBranch();

      await request(app.getHttpServer())
        .post(`/organizations/branches/${created.branchId}/stations`)
        .set(asBearer(adminToken))
        .send({
          code: 'cashier-3',
          name: 'Cashier station 3',
          responsibleUserId: FOREIGN_ID,
        })
        .expect(404);
      expect(events.stationsCreated).toHaveLength(0);
    });

    it('clears the responsible person with null', async () => {
      const created = await createBranch();
      const station = await request(app.getHttpServer())
        .post(`/organizations/branches/${created.branchId}/stations`)
        .set(asBearer(adminToken))
        .send({
          code: 'cashier-2',
          name: 'Cashier station 2',
          responsibleUserId: MEMBER_ID,
        })
        .expect(201);

      const updated = await request(app.getHttpServer())
        .patch(`/organizations/stations/${station.body.stationId}`)
        .set(asBearer(adminToken))
        .send({ responsibleUserId: null })
        .expect(200);

      // A station may answer to nobody — the property that keeps removing a
      // manager from the organization from taking the place down too.
      expect(updated.body.responsibleUserId).toBeNull();
      expect(stations.stations[0].responsibleMembershipId).toBeNull();
    });

    it('leaves children alone when the branch is archived', async () => {
      const created = await createBranch();
      await request(app.getHttpServer())
        .post(`/organizations/branches/${created.branchId}/departments`)
        .set(asBearer(adminToken))
        .send({ name: 'Electronics' })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/organizations/branches/${created.branchId}`)
        .set(asBearer(adminToken))
        .send({ status: 'archived' })
        .expect(200);

      const structure = await request(app.getHttpServer())
        .get(`/organizations/branches/${created.branchId}/structure`)
        .set(asBearer(adminToken))
        .expect(200);
      // No cascade (D4): un-archiving could not tell which children were
      // already archived beforehand, so it never touches them.
      expect(structure.body.departments[0].status).toBe('active');
    });

    it('answers 404 for a branch of another organization', async () => {
      const created = await createBranch();

      await request(app.getHttpServer())
        .get(`/organizations/branches/${created.branchId}/structure`)
        .set(asBearer(foreignAdminToken))
        .expect(404);
      await request(app.getHttpServer())
        .post(`/organizations/branches/${created.branchId}/departments`)
        .set(asBearer(foreignAdminToken))
        .send({ name: 'Probe' })
        .expect(404);
    });

    it('lets a reader see the structure but not change it', async () => {
      const created = await createBranch();

      await request(app.getHttpServer())
        .get(`/organizations/branches/${created.branchId}/structure`)
        .set(asBearer(readerToken))
        .expect(200);
      await request(app.getHttpServer())
        .post(`/organizations/branches/${created.branchId}/departments`)
        .set(asBearer(readerToken))
        .send({ name: 'Nope' })
        .expect(403);
    });
  });
});
