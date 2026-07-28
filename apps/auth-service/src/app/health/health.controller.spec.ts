import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { validateEnv } from '@helpdesk-ai/configuration';
import {
  correlationMiddleware,
  REQUEST_ID_HEADER,
} from '@helpdesk-ai/observability';
import { AppModule } from '../app.module';
import { authServiceEnvSchema } from '../../config/env';

describe('Health endpoints (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // LOG_LEVEL fatal keeps request logging out of the test output.
    const env = validateEnv(authServiceEnvSchema, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    app.use(correlationMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health reports the service as alive', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'auth-service',
      environment: 'test',
    });
  });

  it('GET /health/ready responds with an honest empty check list', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body.status).toBe('ok');
    expect(response.body.checks).toEqual([]);
  });

  it('issues a request id when the client sends none', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.headers[REQUEST_ID_HEADER]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
