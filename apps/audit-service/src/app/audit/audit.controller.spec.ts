import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { PERMISSIONS } from '@helpdesk-ai/security';
import { AUDIT_EVENT_REPOSITORY } from '../../application/ports/audit-event.repository';
import { RecordAuditEventUseCase } from '../../application/use-cases/record-audit-event';
import {
  FixedClock,
  InMemoryAuditEventRepository,
} from '../../application/testing/fakes';
import { auditServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
};

const TEST_ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const OTHER_ORGANIZATION = '00000000-0000-4000-8000-0000000000ff';

const LOCAL_EVENT_ID = '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f';
const FOREIGN_EVENT_ID = '00000000-0000-4000-8000-00000000000f';

describe('Audit HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let events: InMemoryAuditEventRepository;
  let adminToken: string;
  let agentToken: string;
  let orglessAdminToken: string;
  let foreignAdminToken: string;

  beforeAll(async () => {
    const env = validateEnv(auditServiceEnvSchema, TEST_ENV);
    events = new InMemoryAuditEventRepository();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(AUDIT_EVENT_REPOSITORY)
      .useValue(events)
      // Replacing the client keeps the suite broker-free: the real one owns
      // a live AMQP connection.
      .overrideProvider(MessagingClient)
      .useValue({
        subscribeFirehose: async () => undefined,
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
    adminToken = await jwt.signAsync(
      {
        email: 'root@example.com',
        roles: ['admin'],
        org: TEST_ORGANIZATION,
        perms: [PERMISSIONS.AUDIT_READ],
      },
      { subject: '44444444-4444-4444-8444-444444444444' },
    );
    // Agent-shaped grants, none of them audit.read: behavior preserved —
    // agents could not read the trail before either.
    agentToken = await jwt.signAsync(
      {
        email: 'agent@example.com',
        roles: ['agent'],
        org: TEST_ORGANIZATION,
        perms: [
          PERMISSIONS.TICKETS_READ_ALL,
          PERMISSIONS.TICKETS_NOTE_INTERNAL,
        ],
      },
      { subject: '33333333-3333-4333-8333-333333333333' },
    );
    // The grant without the tenant: real between registering and belonging.
    orglessAdminToken = await jwt.signAsync(
      {
        email: 'limbo@example.com',
        roles: ['admin'],
        perms: [PERMISSIONS.AUDIT_READ],
      },
      { subject: '55555555-5555-4555-8555-555555555555' },
    );
    foreignAdminToken = await jwt.signAsync(
      {
        email: 'other-root@example.com',
        roles: ['admin'],
        org: OTHER_ORGANIZATION,
        perms: [PERMISSIONS.AUDIT_READ],
      },
      { subject: '66666666-6666-4666-8666-666666666666' },
    );

    const record = new RecordAuditEventUseCase(
      events,
      new FixedClock(new Date('2026-07-28T12:00:05.000Z')),
    );
    await record.execute({
      id: LOCAL_EVENT_ID,
      type: 'ticket.created.v2',
      occurredAt: '2026-07-28T12:00:00.000Z',
      organizationId: TEST_ORGANIZATION,
      payload: { ticketId: 'abc' },
    });
    // A second tenant's row: the isolation assertions target its identity.
    await record.execute({
      id: FOREIGN_EVENT_ID,
      type: 'ticket.created.v2',
      occurredAt: '2026-07-28T12:01:00.000Z',
      organizationId: OTHER_ORGANIZATION,
      payload: { ticketId: 'not-yours' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated access and non-admin staff', async () => {
    await request(app.getHttpServer()).get('/audit').expect(401);
    await request(app.getHttpServer())
      .get('/audit')
      .set('authorization', `Bearer ${agentToken}`)
      .expect(403);
  });

  it('rejects audit.read without an organization claim with 403', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit')
      .set('authorization', `Bearer ${orglessAdminToken}`)
      .expect(403);

    // The shared NoOrganizationContextError, mapped by the error filter:
    // authenticated and entitled to the trail, but to no slice of it yet.
    expect(response.body.message).toBe(
      'Your account is not part of an organization yet',
    );
  });

  it('serves the trail to admins with ISO dates and raw payloads', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit?type=ticket.created.v2')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: LOCAL_EVENT_ID,
        type: 'ticket.created.v2',
        occurredAt: '2026-07-28T12:00:00.000Z',
        correlationId: null,
        payload: { ticketId: 'abc' },
        recordedAt: '2026-07-28T12:00:05.000Z',
      },
    ]);
  });

  it('never serves another organization: absence checked by identity', async () => {
    const local = await request(app.getHttpServer())
      .get('/audit')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    const localIds = (local.body as { id: string }[]).map((row) => row.id);
    expect(localIds).toEqual([LOCAL_EVENT_ID]);
    expect(localIds).not.toContain(FOREIGN_EVENT_ID);

    const foreign = await request(app.getHttpServer())
      .get('/audit')
      .set('authorization', `Bearer ${foreignAdminToken}`)
      .expect(200);
    const foreignIds = (foreign.body as { id: string }[]).map((row) => row.id);
    expect(foreignIds).toEqual([FOREIGN_EVENT_ID]);
    expect(foreignIds).not.toContain(LOCAL_EVENT_ID);
  });

  it('validates query params: oversized limits and malformed types are 400', async () => {
    // A valid in-range limit must convert and pass (regression: @Type).
    await request(app.getHttpServer())
      .get('/audit?limit=20')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .get('/audit?limit=100000')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .get("/audit?type=1';DROP TABLE audit_events;--")
      .set('authorization', `Bearer ${adminToken}`)
      .expect(400);
  });
});
