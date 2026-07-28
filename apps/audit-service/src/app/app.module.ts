import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import {
  AUDIT_EVENT_REPOSITORY,
  CLOCK,
  SystemClock,
  type AuditEventRepository,
  type Clock,
} from '../application/ports/audit-event.repository';
import { ListAuditEventsUseCase } from '../application/use-cases/list-audit-events';
import { RecordAuditEventUseCase } from '../application/use-cases/record-audit-event';
import { APP_ENV, SERVICE_NAME, type AuditServiceEnv } from '../config/env';
import { PrismaAuditEventRepository } from '../infrastructure/prisma/prisma-audit-event.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { AuditController } from './audit/audit.controller';
import { HealthController } from './health/health.controller';
import { EventLogConsumer } from './messaging/event-log.consumer';

/**
 * Root module built from an already-validated environment; ports meet their
 * infrastructure implementations here and nowhere else.
 */
@Module({})
export class AppModule {
  static forRoot(env: AuditServiceEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot({
          serviceName: SERVICE_NAME,
          environment: env.NODE_ENV,
          logLevel: env.LOG_LEVEL,
        }),
        // Verification only: this service never signs tokens.
        JwtModule.register({ secret: env.JWT_ACCESS_SECRET }),
      ],
      controllers: [HealthController, AuditController],
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: CLOCK, useClass: SystemClock },
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(env.DATABASE_URL),
        },
        {
          provide: AUDIT_EVENT_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaAuditEventRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: MessagingClient,
          useFactory: (logger: Logger) =>
            new MessagingClient({
              url: env.RABBITMQ_URL,
              serviceName: SERVICE_NAME,
              logger,
            }),
          inject: [Logger],
        },
        {
          provide: RecordAuditEventUseCase,
          useFactory: (events: AuditEventRepository, clock: Clock) =>
            new RecordAuditEventUseCase(events, clock),
          inject: [AUDIT_EVENT_REPOSITORY, CLOCK],
        },
        {
          provide: ListAuditEventsUseCase,
          useFactory: (events: AuditEventRepository) =>
            new ListAuditEventsUseCase(events),
          inject: [AUDIT_EVENT_REPOSITORY],
        },
        {
          provide: EventLogConsumer,
          useFactory: (
            messaging: MessagingClient,
            recordEvent: RecordAuditEventUseCase,
            logger: Logger,
          ) => new EventLogConsumer(messaging, recordEvent, logger),
          inject: [MessagingClient, RecordAuditEventUseCase, Logger],
        },
        JwtAccessGuard,
      ],
    };
  }
}
