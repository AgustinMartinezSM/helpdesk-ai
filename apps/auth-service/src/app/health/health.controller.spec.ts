import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import {
  correlationMiddleware,
  REQUEST_ID_HEADER,
} from '@helpdesk-ai/observability';
import { EVENT_PUBLISHER } from '../../application/ports/event-publisher';
import { FakeEventPublisher } from '../../application/testing/fakes';
import { AppModule } from '../app.module';
import { authServiceEnvSchema } from '../../config/env';

// Points at a closed port on purpose: these fast tests must not depend on
// Docker, and readiness has to report the database as down deterministically.
const TEST_ENV = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:59999/unreachable',
  RABBITMQ_URL: 'amqp://nobody:nothing@127.0.0.1:59998',
  JWT_ACCESS_SECRET: 'test-secret-0123456789abcdef0123456789abcdef',
};

describe('Health endpoints (no database)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const env = validateEnv(authServiceEnvSchema, TEST_ENV);

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    })
      .overrideProvider(EVENT_PUBLISHER)
      .useValue(new FakeEventPublisher())
      .compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(correlationMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports liveness regardless of the database', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'auth-service',
      environment: 'test',
    });
  });

  it('GET /health/ready answers 503 with the database marked down', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(503);

    expect(response.body.checks).toEqual([
      { name: 'database', status: 'down' },
    ]);
  }, 15000);

  it('issues a request id when the client sends none', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
