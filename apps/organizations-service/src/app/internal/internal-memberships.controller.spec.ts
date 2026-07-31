import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { MEMBERSHIP_REPOSITORY } from '../../application/ports/membership.repository';
import { ORGANIZATION_REPOSITORY } from '../../application/ports/organization.repository';
import {
  FakeMembershipEventPublisher,
  InMemoryMembershipRepository,
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
  const events = new FakeMembershipEventPublisher();

  beforeAll(async () => {
    const env = validateEnv(organizationsServiceEnvSchema, TEST_ENV);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(ORGANIZATION_REPOSITORY)
      .useValue(organizations)
      .overrideProvider(MEMBERSHIP_REPOSITORY)
      .useValue(memberships)
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
    events.statusChanged.length = 0;
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
    expect(new Set(response.body.permissions)).toEqual(
      permissionsForTemplate('agent'),
    );
  });
});
