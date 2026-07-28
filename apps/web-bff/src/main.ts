import helmet from 'helmet';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { validateEnv } from '@helpdesk-ai/configuration';
import {
  correlationMiddleware,
  Logger,
  LoggerErrorInterceptor,
} from '@helpdesk-ai/observability';
import { AppModule } from './app/app.module';
import { SERVICE_NAME, webBffEnvSchema } from './config/env';

async function bootstrap(): Promise<void> {
  // Fail fast: configuration problems must stop the process here, before any
  // module wiring, with an error that names each offending variable.
  const env = validateEnv(webBffEnvSchema, process.env);

  const app = await NestFactory.create(AppModule.forRoot(env), {
    // Hold Nest's own bootstrap logs until the pino logger takes over.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.use(correlationMiddleware);
  app.use(helmet());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // credentials:true lets the browser send the httpOnly session cookie;
  // safe only because the origin list is explicit, never a wildcard.
  app.enableCors({ origin: env.CORS_ALLOWED_ORIGINS, credentials: true });
  app.enableShutdownHooks();

  await app.listen(env.PORT);
  app
    .get(Logger)
    .log(`${SERVICE_NAME} listening on http://localhost:${env.PORT}`);
}

void bootstrap();
