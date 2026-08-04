import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { PERMISSIONS } from '@helpdesk-ai/security';
import {
  TICKET_SNAPSHOT_REPOSITORY,
  USER_SNAPSHOT_REPOSITORY,
} from '../../application/ports/analytics.repository';
import {
  InMemoryTicketSnapshotRepository,
  InMemoryUserSnapshotRepository,
} from '../../application/testing/fakes';
import { analyticsServiceEnvSchema } from '../../config/env';
import { AppModule } from '../app.module';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
};

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('Analytics HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let adminToken: string;
  let tenantlessAdminToken: string;
  let agentToken: string;
  let userToken: string;

  beforeAll(async () => {
    const env = validateEnv(analyticsServiceEnvSchema, TEST_ENV);
    const tickets = new InMemoryTicketSnapshotRepository();
    const users = new InMemoryUserSnapshotRepository();

    await tickets.applyCreated({
      ticketId: '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222',
      organizationId: ORG,
      status: 'open',
      priority: 'medium',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    // The membership is what makes the account count under the org — and
    // since Sprint 10.7 it is the only thing that writes this projection.
    await users.applyMembershipCreated({
      userId: '11111111-1111-4111-8111-111111111111',
      organizationId: ORG,
      createdAt: new Date('2026-07-28T12:00:01.000Z'),
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(TICKET_SNAPSHOT_REPOSITORY)
      .useValue(tickets)
      .overrideProvider(USER_SNAPSHOT_REPOSITORY)
      .useValue(users)
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
    adminToken = await jwt.signAsync(
      {
        email: 'root@example.com',
        org: ORG,
        perms: [PERMISSIONS.ANALYTICS_READ],
      },
      { subject: '44444444-4444-4444-8444-444444444444' },
    );
    // Right permission, no organization: the state of an account between
    // registering and its membership event landing. The dashboard has no
    // tenant to scope to, so this must refuse rather than aggregate nothing
    // — or worse, everything.
    tenantlessAdminToken = await jwt.signAsync(
      {
        email: 'root@example.com',
        perms: [PERMISSIONS.ANALYTICS_READ],
      },
      { subject: '44444444-4444-4444-8444-444444444444' },
    );
    // Agent-shaped grants, none of them analytics.read: the matrix keeps the
    // dashboard from agents (docs/architecture/tenancy-target-state.md).
    agentToken = await jwt.signAsync(
      {
        email: 'agent@example.com',
        org: ORG,
        perms: [
          PERMISSIONS.TICKETS_READ_ALL,
          PERMISSIONS.TICKETS_NOTE_INTERNAL,
        ],
      },
      { subject: '33333333-3333-4333-8333-333333333333' },
    );
    userToken = await jwt.signAsync(
      { email: 'ada@example.com', org: ORG },
      { subject: '11111111-1111-4111-8111-111111111111' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated access and plain users', async () => {
    await request(app.getHttpServer()).get('/analytics/summary').expect(401);
    await request(app.getHttpServer())
      .get('/analytics/summary')
      .set('authorization', `Bearer ${userToken}`)
      .expect(403);
  });

  it('refuses agents now that analytics.read left their template', async () => {
    // Pinned behavior change: agents used to pass the generic staff check.
    // The approved matrix narrows the dashboard to analytics.read holders.
    await request(app.getHttpServer())
      .get('/analytics/summary')
      .set('authorization', `Bearer ${agentToken}`)
      .expect(403);
  });

  it('refuses analytics.read holders whose token carries no organization', async () => {
    await request(app.getHttpServer())
      .get('/analytics/summary')
      .set('authorization', `Bearer ${tenantlessAdminToken}`)
      .expect(403);
  });

  it('serves the dashboard summary to analytics.read holders', async () => {
    const response = await request(app.getHttpServer())
      .get('/analytics/summary')
      .set('authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(response.body.totalTickets).toBe(1);
    expect(response.body.byStatus).toEqual({ open: 1 });
    expect(response.body.byPriority).toEqual({ medium: 1 });
    expect(response.body.totalUsers).toBe(1);
    expect(response.body.createdLast7Days).toHaveLength(7);
  });
});
