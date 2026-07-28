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

describe('BFF tickets passthrough (stub gateway)', () => {
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

  it('forwards creation with the bearer token and returns the upstream body', async () => {
    nextResponse = { status: 201, body: { id: 't1', status: 'open' } };

    const response = await request(app.getHttpServer())
      .post('/tickets')
      .set('authorization', 'Bearer user-token')
      .send({ title: 'From the browser', description: 'Through the BFF' })
      .expect(201);

    expect(response.body).toEqual({ id: 't1', status: 'open' });
    expect(received[0]).toMatchObject({
      method: 'POST',
      url: '/api/tickets',
      body: { title: 'From the browser', description: 'Through the BFF' },
    });
    expect(received[0].headers.authorization).toBe('Bearer user-token');
  });

  it('passes list query parameters through', async () => {
    nextResponse = { status: 200, body: { items: [], total: 0 } };

    await request(app.getHttpServer())
      .get('/tickets')
      .query({ status: 'open', take: '5' })
      .set('authorization', 'Bearer user-token')
      .expect(200);

    expect(received[0].url).toBe('/api/tickets?status=open&take=5');
  });

  it('forwards nested routes (status, comments) and error statuses untouched', async () => {
    nextResponse = {
      status: 409,
      body: {
        statusCode: 409,
        message: "A ticket cannot move from 'open' to 'resolved'",
      },
    };

    const conflict = await request(app.getHttpServer())
      .patch('/tickets/t1/status')
      .set('authorization', 'Bearer user-token')
      .send({ status: 'resolved' })
      .expect(409);
    expect(conflict.body.message).toContain('cannot move');
    expect(received[0].url).toBe('/api/tickets/t1/status');

    nextResponse = { status: 401, body: { statusCode: 401 } };
    await request(app.getHttpServer()).get('/tickets').expect(401);
  });
});
