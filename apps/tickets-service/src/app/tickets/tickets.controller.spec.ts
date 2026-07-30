import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { TICKET_REPOSITORY } from '../../application/ports/ticket.repository';
import {
  FakeEventPublisher,
  InMemoryTicketRepository,
} from '../../application/testing/fakes';
import { ticketsServiceEnvSchema } from '../../config/env';
import { TEST_ORGANIZATION } from '../../testing/fixtures';
import { AppModule } from '../app.module';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
};

describe('Tickets HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let userToken: string;
  let otherToken: string;
  let agentToken: string;

  beforeAll(async () => {
    const env = validateEnv(ticketsServiceEnvSchema, TEST_ENV);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(TICKET_REPOSITORY)
      .useValue(new InMemoryTicketRepository())
      // Replacing the adapter keeps the suite broker-free: the real one owns
      // a live AMQP connection.
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(new FakeEventPublisher())
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
      { email: 'user@x.com', roles: ['user'], org: TEST_ORGANIZATION },
      { subject: '11111111-1111-4111-8111-111111111111' },
    );
    otherToken = await jwt.signAsync(
      { email: 'other@x.com', roles: ['user'], org: TEST_ORGANIZATION },
      { subject: '22222222-2222-4222-8222-222222222222' },
    );
    agentToken = await jwt.signAsync(
      { email: 'agent@x.com', roles: ['agent'], org: TEST_ORGANIZATION },
      { subject: '33333333-3333-4333-8333-333333333333' },
    );
  });

  afterAll(async () => {
    await app.close();
  });

  function asUser(token: string) {
    return { authorization: `Bearer ${token}` };
  }

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer()).get('/tickets').expect(401);
    await request(app.getHttpServer())
      .get('/tickets')
      .set('authorization', 'Bearer forged')
      .expect(401);
  });

  it('runs the ticket lifecycle end to end over HTTP', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'Broken printer', description: 'Paper jam forever' })
      .expect(201);
    const id = created.body.id;

    // Another requester cannot even learn the ticket exists.
    await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(otherToken))
      .expect(404);

    // Agent takes it, resolves it; requester confirms by closing.
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/assignee`)
      .set(asUser(agentToken))
      .send({ assigneeId: '33333333-3333-4333-8333-333333333333' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(agentToken))
      .send({ status: 'in_progress' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(agentToken))
      .send({ status: 'resolved' })
      .expect(200);
    const closed = await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(userToken))
      .send({ status: 'closed' })
      .expect(200);
    expect(closed.body.status).toBe('closed');

    const details = await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(userToken))
      .expect(200);
    expect(
      details.body.history.map((h: { action: string }) => h.action),
    ).toEqual([
      'created',
      'assigned',
      'status_changed',
      'status_changed',
      'status_changed',
    ]);
  });

  it('enforces transition rules and staff-only actions', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'VPN drops', description: 'Every 5 minutes' })
      .expect(201);
    const id = created.body.id;

    // open -> resolved is not a legal move, even for staff.
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(agentToken))
      .send({ status: 'resolved' })
      .expect(409);

    // Requesters cannot drive the lifecycle before resolution...
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/status`)
      .set(asUser(userToken))
      .send({ status: 'in_progress' })
      .expect(403);

    // ...nor assign, nor write internal notes.
    await request(app.getHttpServer())
      .patch(`/tickets/${id}/assignee`)
      .set(asUser(userToken))
      .send({ assigneeId: null })
      .expect(403);
    await request(app.getHttpServer())
      .post(`/tickets/${id}/comments`)
      .set(asUser(userToken))
      .send({ body: 'sneaky note', internal: true })
      .expect(403);
  });

  it('filters internal notes from requesters', async () => {
    const created = await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'Slow laptop', description: 'Takes 10 min to boot' })
      .expect(201);
    const id = created.body.id;

    await request(app.getHttpServer())
      .post(`/tickets/${id}/comments`)
      .set(asUser(agentToken))
      .send({ body: 'user seems to have 400 tabs open', internal: true })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/tickets/${id}/comments`)
      .set(asUser(agentToken))
      .send({ body: 'We are looking into it' })
      .expect(201);

    const forRequester = await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(userToken))
      .expect(200);
    expect(
      forRequester.body.comments.map((c: { body: string }) => c.body),
    ).toEqual(['We are looking into it']);

    const forAgent = await request(app.getHttpServer())
      .get(`/tickets/${id}`)
      .set(asUser(agentToken))
      .expect(200);
    expect(forAgent.body.comments).toHaveLength(2);
  });

  it('scopes listings to the requester and validates payloads', async () => {
    const mine = await request(app.getHttpServer())
      .get('/tickets')
      .set(asUser(userToken))
      .expect(200);
    for (const ticket of mine.body.items) {
      expect(ticket.requesterId).toBe('11111111-1111-4111-8111-111111111111');
    }

    await request(app.getHttpServer())
      .post('/tickets')
      .set(asUser(userToken))
      .send({ title: 'ab', description: 'too short title' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/tickets/not-a-uuid')
      .set(asUser(userToken))
      .expect(400);
  });
});
