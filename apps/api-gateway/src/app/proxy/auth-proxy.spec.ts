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
import { createAuthProxy } from './auth-proxy';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

describe('Auth proxy (stub auth-service upstream)', () => {
  let app: INestApplication;
  let upstream: Server;
  const received: RecordedRequest[] = [];

  beforeAll(async () => {
    upstream = createServer((req, res) => {
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
        if (req.url === '/auth/login' && req.method === 'POST') {
          res.statusCode = 200;
          res.end(JSON.stringify({ accessToken: 'from-upstream' }));
          return;
        }
        res.statusCode = 401;
        res.end(
          JSON.stringify({ statusCode: 401, message: 'Invalid credentials' }),
        );
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, '127.0.0.1', resolve),
    );
    const { port } = upstream.address() as AddressInfo;

    const env = validateEnv(apiGatewayEnvSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      AUTH_SERVICE_URL: `http://127.0.0.1:${port}`,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    // Mirror main.ts ordering: correlation first, then the proxy mount.
    app.use(correlationMiddleware);
    app.use(createAuthProxy(env.AUTH_SERVICE_URL));
    await app.init();
  });

  beforeEach(() => {
    received.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('forwards POST bodies after the global body parser consumed them', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'a@b.com', password: 'a-valid-password' })
      .expect(200);

    expect(response.body).toEqual({ accessToken: 'from-upstream' });
    expect(received[0].method).toBe('POST');
    expect(received[0].url).toBe('/auth/login');
    expect(received[0].body).toEqual({
      email: 'a@b.com',
      password: 'a-valid-password',
    });
  });

  it('propagates correlation identifiers to the downstream service', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .set(REQUEST_ID_HEADER, 'gateway-test-id')
      .send({ email: 'a@b.com', password: 'a-valid-password' })
      .expect(200);

    expect(received[0].headers[REQUEST_ID_HEADER]).toBe('gateway-test-id');
  });

  it('passes upstream error statuses through untouched', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: 'bad' })
      .expect(401);

    expect(response.body.message).toBe('Invalid credentials');
    expect(received[0].url).toBe('/auth/refresh');
  });

  it('keeps gateway-owned routes (health) outside the proxy', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    expect(received).toHaveLength(0);
  });
});
