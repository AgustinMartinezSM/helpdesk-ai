import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import {
  CLOCK,
  NOTIFICATION_REPOSITORY,
  SystemClock,
  TICKET_REF_REPOSITORY,
  type Clock,
  type NotificationRepository,
  type TicketRefRepository,
} from '../application/ports/notification.repository';
import {
  ListMyNotificationsUseCase,
  MarkNotificationReadUseCase,
} from '../application/use-cases/notification-queries';
import {
  NotifyAssignedUseCase,
  NotifyCommentAddedUseCase,
  NotifyStatusChangedUseCase,
  RegisterTicketRefUseCase,
} from '../application/use-cases/project-ticket-events';
import {
  APP_ENV,
  SERVICE_NAME,
  type NotificationServiceEnv,
} from '../config/env';
import {
  PrismaNotificationRepository,
  PrismaTicketRefRepository,
} from '../infrastructure/prisma/prisma-notification.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { HealthController } from './health/health.controller';
import { TicketEventsConsumer } from './messaging/ticket-events.consumer';
import { NotificationsController } from './notifications/notifications.controller';

/**
 * Root module built from an already-validated environment; ports meet their
 * infrastructure implementations here and nowhere else.
 */
@Module({})
export class AppModule {
  static forRoot(env: NotificationServiceEnv): DynamicModule {
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
      controllers: [HealthController, NotificationsController],
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: CLOCK, useClass: SystemClock },
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(env.DATABASE_URL),
        },
        {
          provide: NOTIFICATION_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaNotificationRepository(prisma),
          inject: [PrismaService],
        },
        {
          provide: TICKET_REF_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaTicketRefRepository(prisma),
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
          provide: RegisterTicketRefUseCase,
          useFactory: (refs: TicketRefRepository) =>
            new RegisterTicketRefUseCase(refs),
          inject: [TICKET_REF_REPOSITORY],
        },
        {
          provide: NotifyStatusChangedUseCase,
          useFactory: (
            refs: TicketRefRepository,
            notifications: NotificationRepository,
            clock: Clock,
          ) => new NotifyStatusChangedUseCase({ refs, notifications, clock }),
          inject: [TICKET_REF_REPOSITORY, NOTIFICATION_REPOSITORY, CLOCK],
        },
        {
          provide: NotifyAssignedUseCase,
          useFactory: (
            refs: TicketRefRepository,
            notifications: NotificationRepository,
            clock: Clock,
          ) => new NotifyAssignedUseCase({ refs, notifications, clock }),
          inject: [TICKET_REF_REPOSITORY, NOTIFICATION_REPOSITORY, CLOCK],
        },
        {
          provide: NotifyCommentAddedUseCase,
          useFactory: (
            refs: TicketRefRepository,
            notifications: NotificationRepository,
            clock: Clock,
          ) => new NotifyCommentAddedUseCase({ refs, notifications, clock }),
          inject: [TICKET_REF_REPOSITORY, NOTIFICATION_REPOSITORY, CLOCK],
        },
        {
          provide: ListMyNotificationsUseCase,
          useFactory: (notifications: NotificationRepository) =>
            new ListMyNotificationsUseCase(notifications),
          inject: [NOTIFICATION_REPOSITORY],
        },
        {
          provide: MarkNotificationReadUseCase,
          useFactory: (notifications: NotificationRepository, clock: Clock) =>
            new MarkNotificationReadUseCase(notifications, clock),
          inject: [NOTIFICATION_REPOSITORY, CLOCK],
        },
        {
          provide: TicketEventsConsumer,
          useFactory: (
            messaging: MessagingClient,
            registerRef: RegisterTicketRefUseCase,
            notifyStatusChanged: NotifyStatusChangedUseCase,
            notifyAssigned: NotifyAssignedUseCase,
            notifyCommentAdded: NotifyCommentAddedUseCase,
            logger: Logger,
          ) =>
            new TicketEventsConsumer(
              messaging,
              registerRef,
              notifyStatusChanged,
              notifyAssigned,
              notifyCommentAdded,
              logger,
            ),
          inject: [
            MessagingClient,
            RegisterTicketRefUseCase,
            NotifyStatusChangedUseCase,
            NotifyAssignedUseCase,
            NotifyCommentAddedUseCase,
            Logger,
          ],
        },
        JwtAccessGuard,
      ],
    };
  }
}
