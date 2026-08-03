/**
 * The organization setup pass-throughs (Sprint 9.11). Same StubGateway shape
 * the session and people specs use: what matters here is that both hops
 * happen, that the BFF adds no policy, and that a refusal arrives unchanged.
 */
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

describe('Organization setup endpoints (stub gateway)', () => {
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

  it('forwards the branch listing with the caller bearer token', async () => {
    gateway.respond('GET /api/organizations/branches', 200, []);

    await request(app.getHttpServer())
      .get('/organization/branches')
      .set('authorization', 'Bearer jwt-access')
      .expect(200);

    expect(gateway.requests[0].url).toBe('/api/organizations/branches');
    expect(gateway.requests[0].headers.authorization).toBe('Bearer jwt-access');
  });

  it('forwards every write untouched', async () => {
    gateway.respond('POST /api/organizations/branches', 201, {
      branchId: 'b1',
    });
    gateway.respond('PATCH /api/organizations/branches/b1', 200, {
      branchId: 'b1',
      status: 'archived',
    });
    gateway.respond('POST /api/organizations/branches/b1/departments', 201, {
      departmentId: 'd1',
    });
    gateway.respond('POST /api/organizations/branches/b1/stations', 201, {
      stationId: 's1',
    });
    gateway.respond('PATCH /api/organizations/departments/d1', 200, {
      departmentId: 'd1',
    });
    gateway.respond('PATCH /api/organizations/stations/s1', 200, {
      stationId: 's1',
    });

    await request(app.getHttpServer())
      .post('/organization/branches')
      .set('authorization', 'Bearer jwt-access')
      .send({ code: 'store-12', name: 'Store 12' })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/organization/branches/b1')
      .set('authorization', 'Bearer jwt-access')
      .send({ status: 'archived' })
      .expect(200);
    await request(app.getHttpServer())
      .post('/organization/branches/b1/departments')
      .set('authorization', 'Bearer jwt-access')
      .send({ name: 'Electronics' })
      .expect(201);
    await request(app.getHttpServer())
      .post('/organization/branches/b1/stations')
      .set('authorization', 'Bearer jwt-access')
      .send({ code: 'cashier-2', name: 'Cashier station 2' })
      .expect(201);
    await request(app.getHttpServer())
      .patch('/organization/departments/d1')
      .set('authorization', 'Bearer jwt-access')
      .send({ status: 'archived' })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/organization/stations/s1')
      .set('authorization', 'Bearer jwt-access')
      .send({ responsibleUserId: null })
      .expect(200);

    expect(gateway.requests.map((entry) => entry.url)).toEqual([
      '/api/organizations/branches',
      '/api/organizations/branches/b1',
      '/api/organizations/branches/b1/departments',
      '/api/organizations/branches/b1/stations',
      '/api/organizations/departments/d1',
      '/api/organizations/stations/s1',
    ]);
    // Bodies pass through unshaped — including the explicit null that clears
    // a station's responsible person.
    expect(gateway.requests[5].body).toEqual({ responsibleUserId: null });
  });

  it('matches the structure read under its branch', async () => {
    gateway.respond('GET /api/organizations/branches/b1/structure', 200, {
      departments: [],
      stations: [],
    });

    await request(app.getHttpServer())
      .get('/organization/branches/b1/structure')
      .set('authorization', 'Bearer jwt-access')
      .expect(200);

    expect(gateway.requests[0].url).toBe(
      '/api/organizations/branches/b1/structure',
    );
  });

  it('forwards a refusal exactly as the service shaped it', async () => {
    // A 404 on a branch means both "no such branch" and "not yours"; a BFF
    // that turned it into a 403 would confirm the row exists.
    gateway.respond('PATCH /api/organizations/branches/b9', 404, {
      statusCode: 404,
      error: 'Not Found',
      message: 'branch "b9" not found in organization "org-1"',
    });

    const response = await request(app.getHttpServer())
      .patch('/organization/branches/b9')
      .set('authorization', 'Bearer jwt-access')
      .send({ name: 'Probe' })
      .expect(404);

    expect(response.body.error).toBe('Not Found');
  });

  it('forwards the support-team paths, including the literal mine', async () => {
    gateway.respond('GET /api/organizations/teams', 200, []);
    gateway.respond('GET /api/organizations/teams/mine', 200, []);
    gateway.respond('POST /api/organizations/teams', 201, { teamId: 't1' });
    gateway.respond('GET /api/organizations/teams/t1', 200, { teamId: 't1' });
    gateway.respond('PATCH /api/organizations/teams/t1', 200, {
      teamId: 't1',
    });
    gateway.respond('PATCH /api/organizations/teams/t1/members', 200, {
      teamId: 't1',
    });
    gateway.respond('PATCH /api/organizations/teams/t1/branches', 200, {
      teamId: 't1',
    });

    const token = 'Bearer jwt-access';
    await request(app.getHttpServer())
      .get('/organization/teams')
      .set('authorization', token)
      .expect(200);
    // If ':teamId' had been declared first, this would forward to
    // /api/organizations/teams/mine as an id and still work here — the
    // upstream is what would then answer 400. Pinning the URL is the net.
    await request(app.getHttpServer())
      .get('/organization/teams/mine')
      .set('authorization', token)
      .expect(200);
    await request(app.getHttpServer())
      .post('/organization/teams')
      .set('authorization', token)
      .send({ code: 'it', name: 'IT support' })
      .expect(201);
    await request(app.getHttpServer())
      .get('/organization/teams/t1')
      .set('authorization', token)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/organization/teams/t1')
      .set('authorization', token)
      .send({ status: 'archived' })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/organization/teams/t1/members')
      .set('authorization', token)
      .send({ userIds: [] })
      .expect(200);
    await request(app.getHttpServer())
      .patch('/organization/teams/t1/branches')
      .set('authorization', token)
      .send({ branchIds: [] })
      .expect(200);

    expect(gateway.requests.map((entry) => entry.url)).toEqual([
      '/api/organizations/teams',
      '/api/organizations/teams/mine',
      '/api/organizations/teams',
      '/api/organizations/teams/t1',
      '/api/organizations/teams/t1',
      '/api/organizations/teams/t1/members',
      '/api/organizations/teams/t1/branches',
    ]);
    // The empty array survives the hop: it is what makes a team
    // organization-wide, and a BFF that dropped it would silently mean
    // "unchanged" (ADR 0022).
    expect(gateway.requests[6].body).toEqual({ branchIds: [] });
  });

  it('adds no authorization of its own', async () => {
    gateway.respond('POST /api/organizations/branches', 401, {
      statusCode: 401,
    });

    await request(app.getHttpServer())
      .post('/organization/branches')
      .send({ code: 'store-12', name: 'Store 12' })
      .expect(401);

    expect(gateway.requests).toHaveLength(1);
    expect(gateway.requests[0].headers.authorization).toBeUndefined();
  });
});
