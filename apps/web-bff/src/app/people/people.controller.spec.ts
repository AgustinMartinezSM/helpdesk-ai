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

/** Same shape as the session spec's stub: scripted per route, records all. */
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

describe('People endpoints (stub gateway)', () => {
  let app: INestApplication;
  const gateway = new StubGateway();

  beforeAll(async () => {
    const gatewayUrl = await gateway.start();
    const env = validateEnv(webBffEnvSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      GATEWAY_URL: gatewayUrl,
      CORS_ALLOWED_ORIGINS: 'http://localhost:3000',
      SESSION_COOKIE_SECURE: 'false',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(correlationMiddleware);
    await app.init();
  });

  beforeEach(() => {
    gateway.requests.length = 0;
  });

  afterAll(async () => {
    await app.close();
    await gateway.stop();
  });

  it('forwards the directory read with the caller bearer token', async () => {
    gateway.respond('GET /api/users', 200, [
      { userId: 'u1', email: 'a@b.com', displayName: 'Ada' },
    ]);

    const response = await request(app.getHttpServer())
      .get('/people')
      .set('authorization', 'Bearer jwt-access')
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(gateway.requests[0].url).toBe('/api/users');
    expect(gateway.requests[0].headers.authorization).toBe('Bearer jwt-access');
  });

  it('routes invitations to organizations-service, not to users-service', async () => {
    // One browser-facing prefix, two upstreams. The screen should not have to
    // know which service owns which half.
    gateway.respond('GET /api/organizations/invitations', 200, []);

    await request(app.getHttpServer())
      .get('/people/invitations')
      .set('authorization', 'Bearer jwt-access')
      .expect(200);

    expect(gateway.requests[0].url).toBe('/api/organizations/invitations');
  });

  it('passes the status filter through and omits it when unset', async () => {
    gateway.respond(
      'GET /api/organizations/invitations?status=pending',
      200,
      [],
    );
    gateway.respond('GET /api/organizations/invitations', 200, []);

    await request(app.getHttpServer())
      .get('/people/invitations?status=pending')
      .set('authorization', 'Bearer jwt-access')
      .expect(200);
    await request(app.getHttpServer())
      .get('/people/invitations')
      .set('authorization', 'Bearer jwt-access')
      .expect(200);

    expect(gateway.requests[0].url).toBe(
      '/api/organizations/invitations?status=pending',
    );
    expect(gateway.requests[1].url).toBe('/api/organizations/invitations');
  });

  it('returns the one-time code from an issue untouched', async () => {
    // The BFF must not reshape this response: the code exists here and
    // nowhere else, and a helpful transformation would be the one place it
    // could be dropped or logged.
    gateway.respond('POST /api/organizations/invitations', 201, {
      id: 'inv-1',
      inviteeEmail: 'new@empresa.com',
      roleTemplate: 'agent',
      status: 'pending',
      code: 'inv-1.the-secret',
    });

    const response = await request(app.getHttpServer())
      .post('/people/invitations')
      .set('authorization', 'Bearer jwt-access')
      .send({ inviteeEmail: 'new@empresa.com', roleTemplate: 'agent' })
      .expect(201);

    expect(response.body.code).toBe('inv-1.the-secret');
    expect(gateway.requests[0].body).toEqual({
      inviteeEmail: 'new@empresa.com',
      roleTemplate: 'agent',
    });
  });

  it('matches the literal invitation routes before the id route', async () => {
    gateway.respond('POST /api/organizations/invitations/preview', 200, {
      organizationName: 'Acme',
      roleTemplate: 'agent',
    });
    gateway.respond('POST /api/organizations/invitations/accept', 200, {
      membershipCreated: true,
    });

    await request(app.getHttpServer())
      .post('/people/invitations/preview')
      .set('authorization', 'Bearer jwt-access')
      .send({ code: 'inv-1.secret' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/people/invitations/accept')
      .set('authorization', 'Bearer jwt-access')
      .send({ code: 'inv-1.secret' })
      .expect(200);

    // 'preview' and 'accept' must not be swallowed by ':invitationId/revoke'.
    expect(gateway.requests[0].url).toBe(
      '/api/organizations/invitations/preview',
    );
    expect(gateway.requests[1].url).toBe(
      '/api/organizations/invitations/accept',
    );
  });

  it('forwards a refusal exactly as the service shaped it', async () => {
    // The 404-not-403 rules ARE the security design: a BFF that helpfully
    // turned a not-found into a forbidden would confirm the row exists.
    gateway.respond('POST /api/organizations/invitations/accept', 404, {
      statusCode: 404,
      error: 'Not Found',
      message: 'invitation not found',
    });

    const response = await request(app.getHttpServer())
      .post('/people/invitations/accept')
      .set('authorization', 'Bearer jwt-access')
      .send({ code: 'wrong.secret' })
      .expect(404);

    expect(response.body).toEqual({
      statusCode: 404,
      error: 'Not Found',
      message: 'invitation not found',
    });
  });

  describe('member administration (Sprint 9.10)', () => {
    it('passes the directory status filter through', async () => {
      gateway.respond('GET /api/users?status=all', 200, []);

      await request(app.getHttpServer())
        .get('/people?status=all')
        .set('authorization', 'Bearer jwt-access')
        .expect(200);

      expect(gateway.requests[0].url).toBe('/api/users?status=all');
    });

    it('routes the three membership writes to organizations-service', async () => {
      gateway.respond('PATCH /api/organizations/memberships/u1/role', 200, {
        userId: 'u1',
        roleTemplate: 'agent',
        version: 2,
      });
      gateway.respond('PATCH /api/organizations/memberships/u1/status', 200, {
        userId: 'u1',
        status: 'suspended',
        version: 3,
      });
      gateway.respond('PATCH /api/organizations/memberships/u1/branches', 200, {
        userId: 'u1',
        branchIds: ['b1'],
      });

      await request(app.getHttpServer())
        .patch('/people/u1/role')
        .set('authorization', 'Bearer jwt-access')
        .send({ roleTemplate: 'agent' })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/people/u1/status')
        .set('authorization', 'Bearer jwt-access')
        .send({ status: 'suspended' })
        .expect(200);
      await request(app.getHttpServer())
        .patch('/people/u1/branches')
        .set('authorization', 'Bearer jwt-access')
        .send({ branchIds: ['b1'] })
        .expect(200);

      expect(gateway.requests.map((entry) => entry.url)).toEqual([
        '/api/organizations/memberships/u1/role',
        '/api/organizations/memberships/u1/status',
        '/api/organizations/memberships/u1/branches',
      ]);
      // The bodies pass through unshaped, as everything here does.
      expect(gateway.requests[2].body).toEqual({ branchIds: ['b1'] });
    });

    it('reads one member covered branches', async () => {
      // The branch LISTING moved to /organization in Sprint 9.11; what is
      // left under this prefix is the per-member edge.
      gateway.respond('GET /api/organizations/memberships/u1/branches', 200, {
        userId: 'u1',
        branchIds: [],
      });

      await request(app.getHttpServer())
        .get('/people/u1/branches')
        .set('authorization', 'Bearer jwt-access')
        .expect(200);

      expect(gateway.requests[0].url).toBe(
        '/api/organizations/memberships/u1/branches',
      );
    });

    it('forwards an administration refusal verbatim', async () => {
      // 403 for "you may not", 404 for a member of another organization —
      // both shapes are the service's security design, not this layer's.
      gateway.respond('PATCH /api/organizations/memberships/u1/status', 403, {
        statusCode: 403,
        error: 'Forbidden',
        message: 'you cannot change your own membership',
      });

      const response = await request(app.getHttpServer())
        .patch('/people/u1/status')
        .set('authorization', 'Bearer jwt-access')
        .send({ status: 'suspended' })
        .expect(403);

      expect(response.body.message).toBe(
        'you cannot change your own membership',
      );
    });
  });

  it('adds no authorization of its own: an anonymous call still reaches upstream', async () => {
    // The BFF has never decided access and must not start here — the service
    // is the one place that refuses, and a second gate would be a second
    // thing to keep in sync.
    gateway.respond('GET /api/users', 401, { statusCode: 401 });

    await request(app.getHttpServer()).get('/people').expect(401);

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].headers.authorization).toBeUndefined();
  });
});
