import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '@helpdesk-ai/configuration';
import {
  correlationMiddleware,
  Logger,
  LoggerErrorInterceptor,
} from '@helpdesk-ai/observability';
import { AppModule } from './app/app.module';
import { createServiceProxy } from './app/proxy/service-proxy';
import { apiGatewayEnvSchema, SERVICE_NAME } from './config/env';

async function bootstrap(): Promise<void> {
  // Fail fast: configuration problems must stop the process here, before any
  // module wiring, with an error that names each offending variable.
  const env = validateEnv(apiGatewayEnvSchema, process.env);

  const app = await NestFactory.create(AppModule.forRoot(env), {
    // Hold Nest's own bootstrap logs until the pino logger takes over.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.use(correlationMiddleware);
  app.use(helmet());
  // Correlation runs before the proxies, so downstream services receive the
  // same x-request-id / x-trace-id the gateway logged.
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
  app.use(
    createServiceProxy({
      pathFilter: '/api/users',
      rewriteTo: '/users',
      target: env.USERS_SERVICE_URL,
    }),
  );
  app.use(
    createServiceProxy({
      pathFilter: '/api/audit',
      rewriteTo: '/audit',
      target: env.AUDIT_SERVICE_URL,
    }),
  );
  app.use(
    createServiceProxy({
      pathFilter: '/api/notifications',
      rewriteTo: '/notifications',
      target: env.NOTIFICATION_SERVICE_URL,
    }),
  );
  app.use(
    createServiceProxy({
      pathFilter: '/api/analytics',
      rewriteTo: '/analytics',
      target: env.ANALYTICS_SERVICE_URL,
    }),
  );
  app.use(
    createServiceProxy({
      pathFilter: '/api/ai',
      rewriteTo: '/ai',
      target: env.AI_SERVICE_URL,
    }),
  );
  // CORS is intentionally NOT enabled: browsers never call the gateway
  // directly — only the web BFF and other services do, server to server.
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  app
    .get(Logger)
    .log(`${SERVICE_NAME} listening on http://localhost:${env.PORT}`);
}

void bootstrap();
