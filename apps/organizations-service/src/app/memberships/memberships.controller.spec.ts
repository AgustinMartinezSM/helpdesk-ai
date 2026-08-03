/**
 * The person-facing member administration surface (Sprint 9.10), against the
 * real JwtAccessGuard and the real domain error filter.
 *
 * What this suite is for is the HTTP contract: which status code each refusal
 * arrives as, and that the route reaches the use case with the actor the token
 * describes. The rules themselves are covered beside the use cases; duplicating
 * them here would be two places to update when one of them changes.
 */
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
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
} from '../../application/ports/structure.repository';
import {
  FakeOrganizationEventPublisher,
  InMemoryBranchMembershipRepository,
  InMemoryBranchRepository,
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
} from '../../application/testing/fakes';
import type { Branch } from '../../domain/branch';
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
const BRANCH_ID = '44444444-4444-4444-8444-444444444444';
const FOREIGN_BRANCH_ID = '55555555-5555-4555-8555-555555555555';

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: '00000000-0000-4000-8000-000000000010',
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

function branch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: BRANCH_ID,
    organizationId: ORG_A,
    code: 'store-12',
    name: 'Store 12',
    status: 'active',
    timezone: null,
    address: null,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('Member administration HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  const organizations = new InMemoryOrganizationRepository();
  const memberships = new InMemoryMembershipRepository();
  const branches = new InMemoryBranchRepository();
  const branchMemberships = new InMemoryBranchMembershipRepository();
  const events = new FakeOrganizationEventPublisher();
  let adminToken: string;
  let memberToken: string;
  let tenantlessAdminToken: string;

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
    memberToken = await jwt.signAsync(
      {
        email: 'member@empresa.com',
        org: ORG_A,
        perms: [...permissionsForTemplate('requester')],
      },
      { subject: MEMBER_ID },
    );
    // Every permission, no tenant: the shape an account between registering
    // and redeeming carries. requireOrganization must refuse it.
    tenantlessAdminToken = await jwt.signAsync(
      { email: 'floating@empresa.com', perms: adminPerms },
      { subject: ADMIN_ID },
    );
  });

  beforeEach(() => {
    memberships.memberships.length = 0;
    branches.branches.length = 0;
    branchMemberships.edges.length = 0;
    events.statusChanged.length = 0;
    events.roleChanged.length = 0;
    organizations.organizations.clear();
    organizations.add({
      id: ORG_A,
      slug: 'empresa',
      name: 'Empresa',
      status: 'active',
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    memberships.memberships.push(
      membership({
        id: '00000000-0000-4000-8000-00000000000a',
        userId: ADMIN_ID,
        roleTemplate: 'organization_admin',
      }),
      membership(),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function asBearer(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('rejects every route without a token', async () => {
    await request(app.getHttpServer())
      .patch(`/organizations/memberships/${MEMBER_ID}/role`)
      .send({ roleTemplate: 'agent' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/organizations/memberships/${MEMBER_ID}/status`)
      .send({ status: 'suspended' })
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/organizations/memberships/${MEMBER_ID}/branches`)
      .send({ branchIds: [] })
      .expect(401);
    await request(app.getHttpServer())
      .get('/organizations/branches')
      .expect(401);

    expect(events.statusChanged).toHaveLength(0);
    expect(events.roleChanged).toHaveLength(0);
  });

  describe('role', () => {
    it('changes a role and answers with the new version', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/role`)
        .set(asBearer(adminToken))
        .send({ roleTemplate: 'agent' })
        .expect(200);

      expect(response.body).toEqual({
        userId: MEMBER_ID,
        roleTemplate: 'agent',
        version: 2,
      });
      expect(events.roleChanged).toHaveLength(1);
      expect(events.roleChanged[0].fromTemplate).toBe('requester');
    });

    it('creates a branch manager, which the 9.8 ceiling refused', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/role`)
        .set(asBearer(adminToken))
        .send({ roleTemplate: 'branch_manager' })
        .expect(200);
    });

    it('answers 403 without people.assign_roles', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${ADMIN_ID}/role`)
        .set(asBearer(memberToken))
        .send({ roleTemplate: 'agent' })
        .expect(403);
      expect(events.roleChanged).toHaveLength(0);
    });

    it('answers 403 for your own membership', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${ADMIN_ID}/role`)
        .set(asBearer(adminToken))
        .send({ roleTemplate: 'agent' })
        .expect(403);
    });

    it('answers 400 for owner and for a word that is not a template', async () => {
      // The DTO refuses both before the use case is reached: `owner` is
      // absent from the grantable list, not merely out of reach.
      for (const roleTemplate of ['owner', 'superuser']) {
        await request(app.getHttpServer())
          .patch(`/organizations/memberships/${MEMBER_ID}/role`)
          .set(asBearer(adminToken))
          .send({ roleTemplate })
          .expect(400);
      }
    });

    it('answers 409 for the template the row already has', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/role`)
        .set(asBearer(adminToken))
        .send({ roleTemplate: 'requester' })
        .expect(409);
    });

    it('answers 404 for a member of another organization', async () => {
      // Foreign and nonexistent answer alike: a 403 on the foreign id would
      // confirm the person exists somewhere.
      memberships.memberships.push(
        membership({
          id: '00000000-0000-4000-8000-0000000000fa',
          organizationId: ORG_B,
          userId: FOREIGN_ID,
        }),
      );

      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${FOREIGN_ID}/role`)
        .set(asBearer(adminToken))
        .send({ roleTemplate: 'agent' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${UNKNOWN_ID}/role`)
        .set(asBearer(adminToken))
        .send({ roleTemplate: 'agent' })
        .expect(404);
    });

    it('answers 403 for a token carrying no organization', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/role`)
        .set(asBearer(tenantlessAdminToken))
        .send({ roleTemplate: 'agent' })
        .expect(403);
    });
  });

  describe('status', () => {
    it('suspends, then reinstates', async () => {
      const suspended = await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/status`)
        .set(asBearer(adminToken))
        .send({ status: 'suspended' })
        .expect(200);
      expect(suspended.body).toEqual({
        userId: MEMBER_ID,
        status: 'suspended',
        version: 2,
      });

      const reinstated = await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/status`)
        .set(asBearer(adminToken))
        .send({ status: 'active' })
        .expect(200);
      expect(reinstated.body.status).toBe('active');
      expect(events.statusChanged.map((event) => event.fromStatus)).toEqual([
        'active',
        'suspended',
      ]);
    });

    it('removes, and lets the person be brought back', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/status`)
        .set(asBearer(adminToken))
        .send({ status: 'deactivated' })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/status`)
        .set(asBearer(adminToken))
        .send({ status: 'active' })
        .expect(200);
      // The row is still there: removal is a status, never a delete, because
      // the directory projection and the audit trail are built from it.
      expect(memberships.memberships).toHaveLength(2);
    });

    it('answers 403 without people.suspend', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${ADMIN_ID}/status`)
        .set(asBearer(memberToken))
        .send({ status: 'suspended' })
        .expect(403);
      expect(events.statusChanged).toHaveLength(0);
    });

    it('answers 409 for a transition the table refuses', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/status`)
        .set(asBearer(adminToken))
        .send({ status: 'active' })
        .expect(409);
    });

    it('answers 400 for a word that is not a status', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/status`)
        .set(asBearer(adminToken))
        .send({ status: 'paused' })
        .expect(400);
    });
  });

  describe('branches', () => {
    beforeEach(() => {
      branches.branches.push(
        branch(),
        branch({
          id: FOREIGN_BRANCH_ID,
          organizationId: ORG_B,
          name: 'Rival store',
        }),
      );
    });

    // The branch LISTING moved to the structure controller in Sprint 9.11,
    // where the writes for the same noun live; its spec covers the scoping.

    it('replaces the covered set and reads it back', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/branches`)
        .set(asBearer(adminToken))
        .send({ branchIds: [BRANCH_ID] })
        .expect(200);

      const read = await request(app.getHttpServer())
        .get(`/organizations/memberships/${MEMBER_ID}/branches`)
        .set(asBearer(adminToken))
        .expect(200);
      expect(read.body).toEqual({ userId: MEMBER_ID, branchIds: [BRANCH_ID] });

      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/branches`)
        .set(asBearer(adminToken))
        .send({ branchIds: [] })
        .expect(200);
      expect(branchMemberships.edges).toHaveLength(0);
    });

    it('answers 404 for a branch of another organization', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/branches`)
        .set(asBearer(adminToken))
        .send({ branchIds: [FOREIGN_BRANCH_ID] })
        .expect(404);
      expect(branchMemberships.edges).toHaveLength(0);
    });

    it('answers 400 for an id that is not a uuid', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${MEMBER_ID}/branches`)
        .set(asBearer(adminToken))
        .send({ branchIds: ['store-12'] })
        .expect(400);
    });

    it('answers 403 without branches.manage_members', async () => {
      await request(app.getHttpServer())
        .patch(`/organizations/memberships/${ADMIN_ID}/branches`)
        .set(asBearer(memberToken))
        .send({ branchIds: [BRANCH_ID] })
        .expect(403);
    });
  });

  /**
   * Sprint 9.14, D6. Over HTTP through the real guard and pipe, because a
   * literal segment beside a ':userId' route is the shape this repository has
   * got wrong before.
   */
  describe('the grantable role templates (Sprint 9.14)', () => {
    it("wins over ':userId' and answers what the caller may grant", async () => {
      const response = await request(app.getHttpServer())
        .get('/organizations/memberships/role-templates')
        .set(asBearer(adminToken))
        .expect(200);

      // Required case 1: an admin may assign every organization template
      // except owner, and this is the list the invite form renders.
      expect(response.body.roleTemplates).toEqual([
        'organization_admin',
        'branch_manager',
        'service_desk_manager',
        'team_manager',
        'agent',
        'requester',
        'auditor',
      ]);
      // Required case 4, at the boundary: nothing platform-shaped, ever.
      expect(response.body.roleTemplates).not.toContain('owner');
      expect(response.body.roleTemplates).not.toContain('platform_super_admin');
    });

    it('answers an empty list to somebody who grants no roles', async () => {
      const response = await request(app.getHttpServer())
        .get('/organizations/memberships/role-templates')
        .set(asBearer(memberToken))
        .expect(200);

      expect(response.body.roleTemplates).toEqual([]);
    });

    it('refuses a token with no organization', async () => {
      await request(app.getHttpServer())
        .get('/organizations/memberships/role-templates')
        .set(asBearer(tenantlessAdminToken))
        .expect(403);
    });
  });
});
