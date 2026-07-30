import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import { correlationMiddleware } from '@helpdesk-ai/observability';
import { AppModule } from '../app.module';
import { webBffEnvSchema } from '../../config/env';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

describe('BFF AI passthrough (stub gateway)', () => {
  let app: INestApplication;
  let gateway: Server;
  const received: RecordedRequest[] = [];
  let nextResponse: { status: number; body: unknown } = {
    status: 200,
    body: {},
  };

  beforeAll(async () => {
    gateway = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        received.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: raw ? JSON.parse(raw) : null,
        });
        res.setHeader('content-type', 'application/json');
        res.statusCode = nextResponse.status;
        res.end(JSON.stringify(nextResponse.body));
      });
    });
    await new Promise<void>((resolve) =>
      gateway.listen(0, '127.0.0.1', resolve),
    );
    const { port } = gateway.address() as AddressInfo;

    const env = validateEnv(webBffEnvSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      GATEWAY_URL: `http://127.0.0.1:${port}`,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(correlationMiddleware);
    await app.init();
  });

  beforeEach(() => {
    received.length = 0;
    nextResponse = { status: 200, body: {} };
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      gateway.close((e) => (e ? reject(e) : resolve())),
    );
  });

  it('forwards a generate request with the bearer token and returns the answer', async () => {
    nextResponse = {
      status: 201,
      body: { id: 's1', task: 'summary', provider: 'local' },
    };

    const response = await request(app.getHttpServer())
      .post('/ai/tickets/t1/suggestions')
      .set('authorization', 'Bearer agent-token')
      .send({ task: 'summary' })
      .expect(201);

    expect(response.body).toEqual({
      id: 's1',
      task: 'summary',
      provider: 'local',
    });
    expect(received[0]).toMatchObject({
      method: 'POST',
      url: '/api/ai/tickets/t1/suggestions',
      body: { task: 'summary' },
    });
    expect(received[0].headers.authorization).toBe('Bearer agent-token');
  });

  it('forwards the provider, latest and history reads', async () => {
    nextResponse = {
      status: 200,
      body: { id: 'local', model: 'heuristics-v1' },
    };
    await request(app.getHttpServer())
      .get('/ai/provider')
      .set('authorization', 'Bearer agent-token')
      .expect(200);
    expect(received[0].url).toBe('/api/ai/provider');

    received.length = 0;
    nextResponse = { status: 200, body: [] };
    await request(app.getHttpServer())
      .get('/ai/tickets/t1/suggestions')
      .set('authorization', 'Bearer agent-token')
      .expect(200);
    expect(received[0].url).toBe('/api/ai/tickets/t1/suggestions');

    received.length = 0;
    await request(app.getHttpServer())
      .get('/ai/tickets/t1/suggestions/priority')
      .set('authorization', 'Bearer agent-token')
      .expect(200);
    expect(received[0].url).toBe('/api/ai/tickets/t1/suggestions/priority');
  });

  it('passes upstream refusals through untouched', async () => {
    nextResponse = {
      status: 403,
      body: {
        statusCode: 403,
        message: 'AI suggestions are available to staff only',
      },
    };

    const forbidden = await request(app.getHttpServer())
      .post('/ai/tickets/t1/suggestions')
      .set('authorization', 'Bearer requester-token')
      .send({ task: 'reply' })
      .expect(403);
    expect(forbidden.body.message).toContain('staff only');

    nextResponse = {
      status: 503,
      body: { statusCode: 503, message: 'the local provider could not answer' },
    };
    await request(app.getHttpServer())
      .post('/ai/tickets/t1/suggestions')
      .set('authorization', 'Bearer agent-token')
      .send({ task: 'reply' })
      .expect(503);
  });
});
