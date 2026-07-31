import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { PERMISSIONS } from '@helpdesk-ai/security';
import {
  AI_PROVIDER,
  type AiProvider,
  type AiProviderOutput,
  type AiTaskRequest,
} from '../../application/ports/ai-provider';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import {
  CLOCK,
  SUGGESTION_REPOSITORY,
} from '../../application/ports/suggestion.repository';
import { TICKET_SOURCE } from '../../application/ports/ticket-source';
import {
  FakeClock,
  FakeSuggestionRepository,
  FakeTicketSource,
  RecordingEventPublisher,
} from '../../application/testing/fakes';
import { aiServiceEnvSchema } from '../../config/env';
import { TicketNotFoundError } from '../../domain/errors';
import { LocalHeuristicProvider } from '../../infrastructure/providers/local.provider';
import { AppModule } from '../app.module';

const TEST_ORGANIZATION = '00000000-0000-4000-8000-000000000001';

const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
  TICKETS_SERVICE_URL: 'http://tickets.invalid',
};

const REQUESTER = '11111111-1111-4111-8111-111111111111';
const AGENT = '33333333-3333-4333-8333-333333333333';
const TICKET = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';

/**
 * Wraps the real local provider so the happy path exercises the actual
 * adapter, while the failure cases can be triggered without standing up a
 * second application. It reports the same id and model it delegates to.
 */
class SwitchableProvider implements AiProvider {
  readonly id = 'local';
  readonly model = 'heuristics-v1';
  mode: 'delegate' | 'crash' | 'off-schema' = 'delegate';
  private readonly local = new LocalHeuristicProvider();

  async run(request: AiTaskRequest): Promise<AiProviderOutput> {
    if (this.mode === 'crash') {
      throw new Error('upstream refused the connection');
    }
    if (this.mode === 'off-schema') {
      return { data: { verdict: 'ship it' }, model: this.model, usage: null };
    }
    return this.local.run(request);
  }
}

describe('AI HTTP API (fakes, real JWT verification)', () => {
  let app: INestApplication;
  let requesterToken: string;
  let agentToken: string;
  let tickets: FakeTicketSource;
  let provider: SwitchableProvider;
  let events: RecordingEventPublisher;

  beforeAll(async () => {
    const env = validateEnv(aiServiceEnvSchema, TEST_ENV);
    tickets = new FakeTicketSource({
      ticket: {
        id: TICKET,
        title: 'Cannot sign in after the password reset',
        description: 'Every attempt fails with an error since yesterday.',
        status: 'open',
        priority: 'medium',
        category: null,
        requesterId: REQUESTER,
        assigneeId: null,
      },
      comments: [
        {
          authorId: REQUESTER,
          body: 'Still failing this morning.',
          internal: false,
          createdAt: '2026-07-29T09:00:00.000Z',
        },
      ],
    });
    provider = new SwitchableProvider();
    events = new RecordingEventPublisher();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(TICKET_SOURCE)
      .useValue(tickets)
      .overrideProvider(AI_PROVIDER)
      .useValue(provider)
      .overrideProvider(SUGGESTION_REPOSITORY)
      .useValue(new FakeSuggestionRepository())
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(events)
      .overrideProvider(CLOCK)
      .useValue(new FakeClock())
      // Replacing the client keeps the suite broker-free: the real one owns
      // a live AMQP connection.
      .overrideProvider(MessagingClient)
      .useValue({
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
    requesterToken = await jwt.signAsync(
      {
        email: 'ada@example.com',
        roles: ['user'],
        org: TEST_ORGANIZATION,
        // Member-shaped, deliberately without the internal-workspace key.
        perms: [PERMISSIONS.ORGANIZATION_READ, PERMISSIONS.TICKETS_READ_OWN],
      },
      { subject: REQUESTER },
    );
    agentToken = await jwt.signAsync(
      {
        email: 'agent@example.com',
        roles: ['agent'],
        org: TEST_ORGANIZATION,
        perms: [PERMISSIONS.TICKETS_NOTE_INTERNAL],
      },
      { subject: AGENT },
    );
  });

  afterEach(() => {
    provider.mode = 'delegate';
    tickets.failure = null;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated access', async () => {
    await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .send({ task: 'summary' })
      .expect(401);
    await request(app.getHttpServer())
      .get(`/ai/tickets/${TICKET}/suggestions`)
      .expect(401);
  });

  it('refuses requesters on every route', async () => {
    await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${requesterToken}`)
      .send({ task: 'summary' })
      .expect(403);
    await request(app.getHttpServer())
      .get(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${requesterToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .get(`/ai/tickets/${TICKET}/suggestions/summary`)
      .set('authorization', `Bearer ${requesterToken}`)
      .expect(403);
  });

  it('names the provider that answers here', async () => {
    const response = await request(app.getHttpServer())
      .get('/ai/provider')
      .set('authorization', `Bearer ${agentToken}`)
      .expect(200);

    expect(response.body).toEqual({ id: 'local', model: 'heuristics-v1' });
  });

  it('generates a suggestion for staff and records who asked', async () => {
    const response = await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'classification' })
      .expect(201);

    expect(response.body).toMatchObject({
      ticketId: TICKET,
      task: 'classification',
      provider: 'local',
      model: 'heuristics-v1',
      requestedBy: AGENT,
      usage: null,
      output: { category: 'access' },
    });
    expect(response.body.contextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(events.published.at(-1)).toMatchObject({
      ticketId: TICKET,
      task: 'classification',
    });
  });

  it('forwards the caller own token to the ticket source', async () => {
    await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'summary' })
      .expect(201);

    expect(tickets.calls.at(-1)?.accessToken).toBe(agentToken);
  });

  it('propagates the correlation identifiers of the inbound request', async () => {
    await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .set('x-trace-id', 'trace-42')
      .send({ task: 'summary' })
      .expect(201);

    expect(tickets.calls.at(-1)?.correlation).toMatchObject({
      'x-trace-id': 'trace-42',
    });
  });

  it('lists the newest suggestion per task and serves one task history', async () => {
    await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'reply' })
      .expect(201);

    const latest = await request(app.getHttpServer())
      .get(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .expect(200);
    const tasks = latest.body.map((row: { task: string }) => row.task);
    expect(tasks).toContain('reply');
    // One row per task, however many times each was generated above.
    expect(new Set(tasks).size).toBe(tasks.length);

    const history = await request(app.getHttpServer())
      .get(`/ai/tickets/${TICKET}/suggestions/summary?limit=1`)
      .set('authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(history.body).toHaveLength(1);
    expect(history.body[0].task).toBe('summary');
  });

  it('validates the request body and the task path segment', async () => {
    await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'sentiment' })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'summary', temperature: 2 })
      .expect(400);

    await request(app.getHttpServer())
      .post('/ai/tickets/not-a-uuid/suggestions')
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'summary' })
      .expect(400);

    await request(app.getHttpServer())
      .get(`/ai/tickets/${TICKET}/suggestions/sentiment`)
      .set('authorization', `Bearer ${agentToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .get(`/ai/tickets/${TICKET}/suggestions/summary?limit=999`)
      .set('authorization', `Bearer ${agentToken}`)
      .expect(400);
  });

  it('answers 404 when the ticket cannot be read, without confirming it exists', async () => {
    tickets.failure = new TicketNotFoundError();

    const response = await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'summary' })
      .expect(404);

    expect(response.body.message).toBe('ticket not found');
  });

  it('answers 503 when the provider cannot be reached', async () => {
    provider.mode = 'crash';

    await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'summary' })
      .expect(503);
  });

  it('answers 502 when the provider answers off-schema', async () => {
    provider.mode = 'off-schema';

    const response = await request(app.getHttpServer())
      .post(`/ai/tickets/${TICKET}/suggestions`)
      .set('authorization', `Bearer ${agentToken}`)
      .send({ task: 'summary' })
      .expect(502);

    expect(response.body.message).toContain('off-schema');
  });
});
