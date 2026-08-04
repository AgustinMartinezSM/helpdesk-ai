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
  permissions: ['tickets.create', 'tickets.read_own'],
  organizationId: 'org-1',
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
      // Permissions travel to the browser (ADR 0020); refreshTokenId does
      // not, because toBrowserSession is an allowlist rather than a delete.
      permissions: ['tickets.create', 'tickets.read_own'],
      organizationId: 'org-1',
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

  it('login keeps Max-Age normally and drops it on a shared workstation', async () => {
    gateway.respond('POST /api/auth/login', 200, SESSION_BODY);

    const normal = await request(app.getHttpServer())
      .post('/session/login')
      .send({ email: 'a@b.com', password: 'a-valid-password' })
      .expect(200);
    expect(normal.headers['set-cookie']?.[0]).toContain('Max-Age=');

    const shared = await request(app.getHttpServer())
      .post('/session/login')
      .send({
        email: 'a@b.com',
        password: 'a-valid-password',
        sharedWorkstation: true,
      })
      .expect(200);
    // No Max-Age and no Expires: the cookie dies with the browser, so
    // closing the till's window ends the session locally while the
    // shortened upstream TTL bounds it anyway.
    const cookie = shared.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain('helpdesk_refresh=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).not.toContain('Max-Age=');
    expect(cookie).not.toContain('Expires=');

    // The flag reached auth-service: it decides the upstream TTL there.
    expect(gateway.requests.at(-1)?.body).toMatchObject({
      sharedWorkstation: true,
    });
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

  /* Choosing an organization (Sprint 10.6, ADR 0025). */

  function organizationCookie(response: {
    headers: Record<string, string[] | undefined>;
  }): string {
    return (
      (response.headers['set-cookie'] ?? []).find((value) =>
        value.startsWith('helpdesk_org='),
      ) ?? ''
    );
  }

  it('choosing an organization forwards the bearer token and remembers the result', async () => {
    gateway.respond('POST /api/auth/session/organization', 200, {
      ...SESSION_BODY,
      organizationId: 'org-2',
      // The exchange mints no refresh credential; the client keeps its own.
      refreshToken: undefined,
    });

    const response = await request(app.getHttpServer())
      .post('/session/organization')
      .set('authorization', 'Bearer jwt-access')
      .send({ organizationId: '00000000-0000-4000-8000-0000000000bb' })
      .expect(200);

    expect(response.body.organizationId).toBe('org-2');
    expect(gateway.requests[0].url).toBe('/api/auth/session/organization');
    expect(gateway.requests[0].headers.authorization).toBe('Bearer jwt-access');

    const cookie = organizationCookie(response);
    expect(cookie).toContain('helpdesk_org=org-2');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/session');
  });

  it('remembers what the server MINTED, not what was asked for', async () => {
    // The difference between a remembered choice and a browser insisting.
    gateway.respond('POST /api/auth/session/organization', 200, {
      ...SESSION_BODY,
      organizationId: 'org-actually-minted',
    });

    const response = await request(app.getHttpServer())
      .post('/session/organization')
      .set('authorization', 'Bearer jwt-access')
      .send({ organizationId: '00000000-0000-4000-8000-0000000000bb' })
      .expect(200);

    expect(organizationCookie(response)).toContain(
      'helpdesk_org=org-actually-minted',
    );
  });

  it('forwards a refusal untouched and remembers nothing', async () => {
    gateway.respond('POST /api/auth/session/organization', 404, {
      statusCode: 404,
      error: 'Not Found',
      message: 'That organization is not available to this account',
    });

    const response = await request(app.getHttpServer())
      .post('/session/organization')
      .set('authorization', 'Bearer jwt-access')
      .send({ organizationId: '00000000-0000-4000-8000-0000000000cc' })
      .expect(404);

    expect(response.body.message).toMatch(/not available/i);
    // Writing the cookie before the server agreed would leave the browser
    // asking for something it was just refused, on every refresh.
    expect(organizationCookie(response)).toBe('');
  });

  it('refuses a body that is not a uuid', async () => {
    await request(app.getHttpServer())
      .post('/session/organization')
      .set('authorization', 'Bearer jwt-access')
      .send({ organizationId: 'acme' })
      .expect(400);
  });

  it('refresh carries the remembered organization upstream', async () => {
    gateway.respond('POST /api/auth/refresh', 200, {
      ...SESSION_BODY,
      organizationId: 'org-2',
    });

    await request(app.getHttpServer())
      .post('/session/refresh')
      .set('cookie', 'helpdesk_refresh=rt-1.rt-secret; helpdesk_org=org-2')
      .expect(200);

    expect(gateway.requests[0].body).toEqual({
      refreshToken: 'rt-1.rt-secret',
      organizationId: 'org-2',
    });
  });

  it('refresh sends no organization when nothing is remembered', async () => {
    gateway.respond('POST /api/auth/refresh', 200, SESSION_BODY);

    await request(app.getHttpServer())
      .post('/session/refresh')
      .set('cookie', 'helpdesk_refresh=rt-1.rt-secret')
      .expect(200);

    expect(gateway.requests[0].body).toEqual({
      refreshToken: 'rt-1.rt-secret',
    });
  });

  it('refresh REWRITES a stale choice instead of failing', async () => {
    // Somebody removed from the organization their browser remembers. The
    // service falls back and answers a different one; the cookie has to
    // follow, or the browser keeps asking for a place it cannot go.
    gateway.respond('POST /api/auth/refresh', 200, {
      ...SESSION_BODY,
      organizationId: 'org-1',
    });

    const response = await request(app.getHttpServer())
      .post('/session/refresh')
      .set('cookie', 'helpdesk_refresh=rt-1.rt-secret; helpdesk_org=org-gone')
      .expect(200);

    expect(response.body.organizationId).toBe('org-1');
    expect(organizationCookie(response)).toContain('helpdesk_org=org-1');
  });

  it('refresh clears the choice when the session has no tenant at all', async () => {
    gateway.respond('POST /api/auth/refresh', 200, {
      ...SESSION_BODY,
      organizationId: null,
      permissions: [],
    });

    const response = await request(app.getHttpServer())
      .post('/session/refresh')
      .set('cookie', 'helpdesk_refresh=rt-1.rt-secret; helpdesk_org=org-gone')
      .expect(200);

    expect(organizationCookie(response)).toContain('helpdesk_org=;');
  });

  it('login clears a remembered choice: a fresh sign-in uses the default rule', async () => {
    gateway.respond('POST /api/auth/login', 200, SESSION_BODY);

    const response = await request(app.getHttpServer())
      .post('/session/login')
      .set('cookie', 'helpdesk_org=org-2')
      .send({ email: 'a@b.com', password: 'a-valid-password' })
      .expect(200);

    // Deterministic, and no flicker: honouring it only on the next refresh
    // would land somebody in one organization and move them seconds later.
    expect(organizationCookie(response)).toContain('helpdesk_org=;');
    expect(gateway.requests[0].body).not.toHaveProperty('organizationId');
  });

  it('logout clears both cookies', async () => {
    gateway.respond('POST /api/auth/logout', 204, null);

    const response = await request(app.getHttpServer())
      .post('/session/logout')
      .set('cookie', 'helpdesk_refresh=rt-1.rt-secret; helpdesk_org=org-2')
      .expect(204);

    const cookies = response.headers['set-cookie'] ?? [];
    expect(
      cookies.some((value) => value.startsWith('helpdesk_refresh=;')),
    ).toBe(true);
    expect(cookies.some((value) => value.startsWith('helpdesk_org=;'))).toBe(
      true,
    );
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
