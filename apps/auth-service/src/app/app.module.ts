import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ObservabilityModule } from '@helpdesk-ai/observability';
import { APP_ENV, SERVICE_NAME, type AuthServiceEnv } from '../config/env';
import { HealthController } from './health/health.controller';

/**
 * Root module built from an already-validated environment.
 *
 * The environment is validated once in main.ts (fail fast, typed) and enters
 * the module graph through the APP_ENV token; see web-bff's AppModule for the
 * rationale versus @nestjs/config.
 */
@Module({})
export class AppModule {
  static forRoot(env: AuthServiceEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot({
          serviceName: SERVICE_NAME,
          environment: env.NODE_ENV,
          logLevel: env.LOG_LEVEL,
        }),
      ],
      controllers: [HealthController],
      providers: [{ provide: APP_ENV, useValue: env }],
    };
  }
}
