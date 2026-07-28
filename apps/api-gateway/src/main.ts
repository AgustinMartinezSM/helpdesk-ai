import helmet from 'helmet';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '@helpdesk-ai/configuration';
import {
  correlationMiddleware,
  Logger,
  LoggerErrorInterceptor,
} from '@helpdesk-ai/observability';
import { AppModule } from './app/app.module';
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
  // CORS is intentionally NOT enabled: browsers never call the gateway
  // directly — only the web BFF and other services do, server to server.
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  app
    .get(Logger)
    .log(`${SERVICE_NAME} listening on http://localhost:${env.PORT}`);
}

void bootstrap();
