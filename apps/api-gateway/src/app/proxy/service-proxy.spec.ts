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

/** One entry per downstream the gateway fronts. */
const SERVICES = [
  {
    key: 'auth',
    envVar: 'AUTH_SERVICE_URL',
    prefix: '/api/auth',
    rewriteTo: '/auth',
  },
  {
    key: 'tickets',
    envVar: 'TICKETS_SERVICE_URL',
    prefix: '/api/tickets',
    rewriteTo: '/tickets',
  },
  {
    key: 'users',
    envVar: 'USERS_SERVICE_URL',
    prefix: '/api/users',
    rewriteTo: '/users',
  },
  {
    key: 'audit',
    envVar: 'AUDIT_SERVICE_URL',
    prefix: '/api/audit',
    rewriteTo: '/audit',
  },
  {
    key: 'notifications',
    envVar: 'NOTIFICATION_SERVICE_URL',
    prefix: '/api/notifications',
    rewriteTo: '/notifications',
  },
  {
    key: 'analytics',
    envVar: 'ANALYTICS_SERVICE_URL',
    prefix: '/api/analytics',
    rewriteTo: '/analytics',
  },
] as const;

type ServiceKey = (typeof SERVICES)[number]['key'];

interface RecordedRequest {
  service: ServiceKey;
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

function buildStub(service: ServiceKey, received: RecordedRequest[]): Server {
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
  const stubs = new Map<ServiceKey, Server>();
  const received: RecordedRequest[] = [];

  beforeAll(async () => {
    const envSource: Record<string, string> = {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
    };
    for (const service of SERVICES) {
      const stub = buildStub(service.key, received);
      stubs.set(service.key, stub);
      await new Promise<void>((resolve) =>
        stub.listen(0, '127.0.0.1', resolve),
      );
      const port = (stub.address() as AddressInfo).port;
      envSource[service.envVar] = `http://127.0.0.1:${port}`;
    }

    const env = validateEnv(apiGatewayEnvSchema, envSource);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Mirror main.ts ordering: correlation first, then the proxy mounts.
    app.use(correlationMiddleware);
    for (const service of SERVICES) {
      app.use(
        createServiceProxy({
          pathFilter: service.prefix,
          rewriteTo: service.rewriteTo,
          target: env[service.envVar],
        }),
      );
    }
    await app.init();
  });

  beforeEach(() => {
    received.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await Promise.all(
      [...stubs.values()].map(
        (stub) =>
          new Promise<void>((resolve, reject) =>
            stub.close((e) => (e ? reject(e) : resolve())),
          ),
      ),
    );
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
    await request(app.getHttpServer())
      .get('/api/users/me')
      .set('authorization', 'Bearer token')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/audit?type=ticket.created.v1')
      .set('authorization', 'Bearer token')
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/notifications/abc/read')
      .set('authorization', 'Bearer token')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/analytics/summary')
      .set('authorization', 'Bearer token')
      .expect(200);

    expect(received.map((r) => [r.service, r.url])).toEqual([
      ['auth', '/auth/login'],
      ['tickets', '/tickets'],
      ['users', '/users/me'],
      ['audit', '/audit?type=ticket.created.v1'],
      ['notifications', '/notifications/abc/read'],
      ['analytics', '/analytics/summary'],
    ]);
    expect(received[1].body).toEqual({
      title: 'Via gateway',
      description: 'Routed',
    });
    for (const recorded of received.slice(1)) {
      expect(recorded.headers.authorization).toBe('Bearer token');
    }
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
