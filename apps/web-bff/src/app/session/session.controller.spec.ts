import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import {
  correlationMiddleware,
  TRACE_ID_HEADER,
} from '@helpdesk-ai/observability';
import { AppModule } from '../app.module';
import { webBffEnvSchema } from '../../config/env';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/**
 * Stub gateway: scripted JSON responses per route, records every request so
 * tests can assert forwarding behavior (paths, bodies, correlation headers).
 */
class StubGateway {
  readonly requests: RecordedRequest[] = [];
  private server!: Server;
  private responses = new Map<string, { status: number; body: unknown }>();

  respond(route: string, status: number, body: unknown): void {
    this.responses.set(route, { status, body });
  }

  async start(): Promise<string> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        this.requests.push({
          method: req.method ?? '',
          url: req.url ?? '',
          headers: req.headers,
          body: raw ? JSON.parse(raw) : null,
        });
        const scripted = this.responses.get(`${req.method} ${req.url}`) ?? {
          status: 404,
          body: { statusCode: 404 },
        };
        res.statusCode = scripted.status;
        if (scripted.status === 204) {
          res.end();
          return;
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify(scripted.body));
      });
    });
    await new Promise<void>((resolve) =>
      this.server.listen(0, '127.0.0.1', resolve),
    );
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const SESSION_BODY = {
  accessToken: 'jwt-access',
  expiresInSeconds: 900,
  refreshToken: 'rt-id.rt-secret',
  refreshTokenId: 'rt-id',
  user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
};

describe('Session endpoints (stub gateway)', () => {
  let app: INestApplication;
  let gateway: StubGateway;

  beforeAll(async () => {
    gateway = new StubGateway();
    const gatewayUrl = await gateway.start();

    const env = validateEnv(webBffEnvSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      GATEWAY_URL: gatewayUrl,
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(correlationMiddleware);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    gateway.requests.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await gateway.stop();
  });

  it('login sets an httpOnly refresh cookie and never leaks the refresh token', async () => {
    gateway.respond('POST /api/auth/login', 200, SESSION_BODY);

    const response = await request(app.getHttpServer())
      .post('/session/login')
      .set(TRACE_ID_HEADER, 'trace-from-browser')
      .send({ email: 'a@b.com', password: 'a-valid-password' })
      .expect(200);

    expect(response.body).toEqual({
      accessToken: 'jwt-access',
      expiresInSeconds: 900,
      user: { id: 'u1', email: 'a@b.com', roles: ['user'] },
    });
    expect(JSON.stringify(response.body)).not.toContain('rt-secret');

    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('helpdesk_refresh=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/session');
    expect(cookie).toContain('SameSite=Lax');

    // Correlation travelled to the gateway.
    expect(gateway.requests[0].headers[TRACE_ID_HEADER]).toBe(
      'trace-from-browser',
    );
    expect(gateway.requests[0].url).toBe('/api/auth/login');
  });

  it('login passes upstream 401 through without setting a cookie', async () => {
    gateway.respond('POST /api/auth/login', 401, {
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Invalid credentials',
    });

    const response = await request(app.getHttpServer())
      .post('/session/login')
      .send({ email: 'a@b.com', password: 'wrong-password' })
      .expect(401);

    expect(response.body.message).toBe('Invalid credentials');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refresh reads the cookie, forwards the token and rotates the cookie', async () => {
    gateway.respond('POST /api/auth/refresh', 200, {
      ...SESSION_BODY,
      refreshToken: 'rt2.secret2',
    });

    const response = await request(app.getHttpServer())
      .post('/session/refresh')
      .set('cookie', 'helpdesk_refresh=rt-id.rt-secret')
      .expect(200);

    expect(gateway.requests[0].body).toEqual({
      refreshToken: 'rt-id.rt-secret',
    });
    expect(response.headers['set-cookie']?.[0]).toContain(
      'helpdesk_refresh=rt2.secret2',
    );
  });

  it('refresh without a cookie is 401 and never calls the gateway', async () => {
    await request(app.getHttpServer()).post('/session/refresh').expect(401);
    expect(gateway.requests).toHaveLength(0);
  });

  it('refresh clears the cookie when upstream rejects the token', async () => {
    gateway.respond('POST /api/auth/refresh', 401, {
      statusCode: 401,
      error: 'Unauthorized',
      message: 'Refresh token is invalid or expired',
    });

    const response = await request(app.getHttpServer())
      .post('/session/refresh')
      .set('cookie', 'helpdesk_refresh=stolen.token')
      .expect(401);

    expect(response.headers['set-cookie']?.[0]).toContain('helpdesk_refresh=;');
  });

  it('logout revokes upstream, clears the cookie and stays 204 without one', async () => {
    gateway.respond('POST /api/auth/logout', 204, null);

    const withCookie = await request(app.getHttpServer())
      .post('/session/logout')
      .set('cookie', 'helpdesk_refresh=rt-id.rt-secret')
      .expect(204);
    expect(gateway.requests[0].url).toBe('/api/auth/logout');
    expect(withCookie.headers['set-cookie']?.[0]).toContain(
      'helpdesk_refresh=;',
    );

    gateway.requests.length = 0;
    await request(app.getHttpServer()).post('/session/logout').expect(204);
    expect(gateway.requests).toHaveLength(0);
  });

  it('me forwards the bearer token and passes the identity through', async () => {
    gateway.respond('GET /api/auth/me', 200, {
      id: 'u1',
      email: 'a@b.com',
      roles: ['user'],
    });

    const response = await request(app.getHttpServer())
      .get('/session/me')
      .set('authorization', 'Bearer jwt-access')
      .expect(200);

    expect(response.body.email).toBe('a@b.com');
    expect(gateway.requests[0].headers.authorization).toBe('Bearer jwt-access');
  });
});
