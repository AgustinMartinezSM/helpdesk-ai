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

describe('Audit HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let events: InMemoryAuditEventRepository;
  let adminToken: string;
  let agentToken: string;

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
        perms: [
          PERMISSIONS.TICKETS_READ_ALL,
          PERMISSIONS.TICKETS_NOTE_INTERNAL,
        ],
      },
      { subject: '33333333-3333-4333-8333-333333333333' },
    );

    await new RecordAuditEventUseCase(
      events,
      new FixedClock(new Date('2026-07-28T12:00:05.000Z')),
    ).execute({
      id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
      type: 'ticket.created.v1',
      occurredAt: '2026-07-28T12:00:00.000Z',
      payload: { ticketId: 'abc' },
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

  it('serves the trail to admins with ISO dates and raw payloads', async () => {
    const response = await request(app.getHttpServer())
      .get('/audit?type=ticket.created.v1')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body).toEqual([
      {
        id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
        type: 'ticket.created.v1',
        occurredAt: '2026-07-28T12:00:00.000Z',
        correlationId: null,
        payload: { ticketId: 'abc' },
        recordedAt: '2026-07-28T12:00:05.000Z',
      },
    ]);
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
