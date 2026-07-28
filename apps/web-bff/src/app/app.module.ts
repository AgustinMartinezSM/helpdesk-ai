import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { ObservabilityModule } from '@helpdesk-ai/observability';
import { APP_ENV, SERVICE_NAME, type WebBffEnv } from '../config/env';
import { HealthController } from './health/health.controller';
import {
  GATEWAY_AUTH_CLIENT,
  GatewayAuthClient,
} from './session/gateway-auth.client';
import { SessionController } from './session/session.controller';

/**
 * Root module built from an already-validated environment.
 *
 * The environment is validated once in main.ts (fail fast, typed) and enters
 * the module graph through the APP_ENV token. @nestjs/config was considered
 * and skipped: it validates during module init and exposes values through
 * string keys, while this approach keeps configuration typed end to end with
 * a single validation point. Revisit if per-module configuration namespaces
 * become necessary.
 */
@Module({})
export class AppModule {
  static forRoot(env: WebBffEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot({
          serviceName: SERVICE_NAME,
          environment: env.NODE_ENV,
          logLevel: env.LOG_LEVEL,
        }),
      ],
      controllers: [HealthController, SessionController],
      providers: [
        { provide: APP_ENV, useValue: env },
        {
          provide: GATEWAY_AUTH_CLIENT,
          useFactory: () => new GatewayAuthClient(env.GATEWAY_URL),
        },
      ],
    };
  }
}
