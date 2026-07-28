import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import {
  correlationMiddleware,
  REQUEST_ID_HEADER,
} from '@helpdesk-ai/observability';
import { AppModule } from '../app.module';
import { apiGatewayEnvSchema } from '../../config/env';
import { createServiceProxy } from './service-proxy';

interface RecordedRequest {
  service: 'auth' | 'tickets';
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function buildStub(
  service: 'auth' | 'tickets',
  received: RecordedRequest[],
): Server {
  return createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      received.push({
        service,
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      });
      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ from: service, url: req.url }));
    });
  });
}

describe('Service proxies (stub downstream services)', () => {
  let app: INestApplication;
  let authStub: Server;
  let ticketsStub: Server;
  const received: RecordedRequest[] = [];

  beforeAll(async () => {
    authStub = buildStub('auth', received);
    ticketsStub = buildStub('tickets', received);
    await Promise.all([
      new Promise<void>((resolve) => authStub.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) =>
        ticketsStub.listen(0, '127.0.0.1', resolve),
      ),
    ]);
    const authPort = (authStub.address() as AddressInfo).port;
    const ticketsPort = (ticketsStub.address() as AddressInfo).port;

    const env = validateEnv(apiGatewayEnvSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      AUTH_SERVICE_URL: `http://127.0.0.1:${authPort}`,
      TICKETS_SERVICE_URL: `http://127.0.0.1:${ticketsPort}`,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Mirror main.ts ordering: correlation first, then the proxy mounts.
    app.use(correlationMiddleware);
    app.use(
      createServiceProxy({
        pathFilter: '/api/auth',
        rewriteTo: '/auth',
        target: env.AUTH_SERVICE_URL,
      }),
    );
    app.use(
      createServiceProxy({
        pathFilter: '/api/tickets',
        rewriteTo: '/tickets',
        target: env.TICKETS_SERVICE_URL,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    received.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([
      new Promise<void>((resolve, reject) =>
        authStub.close((e) => (e ? reject(e) : resolve())),
      ),
      new Promise<void>((resolve, reject) =>
        ticketsStub.close((e) => (e ? reject(e) : resolve())),
      ),
    ]);
  });

  it('routes each prefix to its own downstream service with rewritten paths', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'a-valid-password' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/tickets')
      .set('authorization', 'Bearer token')
      .send({ title: 'Via gateway', description: 'Routed' })
      .expect(200);

    expect(received[0]).toMatchObject({ service: 'auth', url: '/auth/login' });
    expect(received[1]).toMatchObject({ service: 'tickets', url: '/tickets' });
    expect(received[1].body).toEqual({
      title: 'Via gateway',
      description: 'Routed',
    });
    expect(received[1].headers.authorization).toBe('Bearer token');
  });

  it('forwards nested ticket routes and correlation identifiers', async () => {
    await request(app.getHttpServer())
      .patch('/api/tickets/abc/status')
      .set(REQUEST_ID_HEADER, 'proxy-test-id')
      .send({ status: 'in_progress' })
      .expect(200);

    expect(received[0].url).toBe('/tickets/abc/status');
    expect(received[0].headers[REQUEST_ID_HEADER]).toBe('proxy-test-id');
  });

  it('keeps gateway-owned routes (health) outside the proxies', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    expect(received).toHaveLength(0);
  });
});
