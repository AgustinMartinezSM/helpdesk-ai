import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import {
  CLOCK,
  SystemClock,
  TICKET_SNAPSHOT_REPOSITORY,
  USER_SNAPSHOT_REPOSITORY,
  type Clock,
  type TicketSnapshotRepository,
  type UserSnapshotRepository,
} from '../application/ports/analytics.repository';
import {
  ApplyMembershipCreatedUseCase,
  ApplyTicketCreatedUseCase,
  ApplyTicketStatusChangedUseCase,
} from '../application/use-cases/apply-events';
import { GetAnalyticsSummaryUseCase } from '../application/use-cases/get-summary';
import { APP_ENV, SERVICE_NAME, type AnalyticsServiceEnv } from '../config/env';
import {
  PrismaTicketSnapshotRepository,
  PrismaUserSnapshotRepository,
} from '../infrastructure/prisma/prisma-analytics.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { AnalyticsController } from './analytics/analytics.controller';
import { HealthController } from './health/health.controller';
import { MetricsConsumer } from './messaging/metrics.consumer';

/**
 * Root module built from an already-validated environment; ports meet their
 * infrastructure implementations here and nowhere else.
 */
@Module({})
export class AppModule {
  static forRoot(env: AnalyticsServiceEnv): DynamicModule {
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
      controllers: [HealthController, AnalyticsController],
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: CLOCK, useClass: SystemClock },
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(env.DATABASE_URL),
        },
        {
          provide: TICKET_SNAPSHOT_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaTicketSnapshotRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: USER_SNAPSHOT_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaUserSnapshotRepository(prisma),
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
          provide: ApplyTicketCreatedUseCase,
          useFactory: (snapshots: TicketSnapshotRepository) =>
            new ApplyTicketCreatedUseCase(snapshots),
          inject: [TICKET_SNAPSHOT_REPOSITORY],
        },
        {
          provide: ApplyTicketStatusChangedUseCase,
          useFactory: (snapshots: TicketSnapshotRepository) =>
            new ApplyTicketStatusChangedUseCase(snapshots),
          inject: [TICKET_SNAPSHOT_REPOSITORY],
        },
        {
          provide: ApplyMembershipCreatedUseCase,
          useFactory: (users: UserSnapshotRepository) =>
            new ApplyMembershipCreatedUseCase(users),
          inject: [USER_SNAPSHOT_REPOSITORY],
        },
        {
          provide: GetAnalyticsSummaryUseCase,
          useFactory: (
            tickets: TicketSnapshotRepository,
            users: UserSnapshotRepository,
            clock: Clock,
          ) => new GetAnalyticsSummaryUseCase(tickets, users, clock),
          inject: [TICKET_SNAPSHOT_REPOSITORY, USER_SNAPSHOT_REPOSITORY, CLOCK],
        },
        {
          provide: MetricsConsumer,
          useFactory: (
            messaging: MessagingClient,
            applyCreated: ApplyTicketCreatedUseCase,
            applyStatusChanged: ApplyTicketStatusChangedUseCase,
            applyMembershipCreated: ApplyMembershipCreatedUseCase,
            logger: Logger,
          ) =>
            new MetricsConsumer(
              messaging,
              applyCreated,
              applyStatusChanged,
              applyMembershipCreated,
              logger,
            ),
          inject: [
            MessagingClient,
            ApplyTicketCreatedUseCase,
            ApplyTicketStatusChangedUseCase,
            ApplyMembershipCreatedUseCase,
            Logger,
          ],
        },
        JwtAccessGuard,
      ],
    };
  }
}
