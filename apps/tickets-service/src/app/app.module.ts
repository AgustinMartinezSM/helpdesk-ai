import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../application/ports/event-publisher';
import {
  MEMBERSHIP_VERIFIER,
  type MembershipVerifier,
} from '../application/ports/membership-verifier';
import {
  CLOCK,
  SystemClock,
  TICKET_REPOSITORY,
  type Clock,
  type TicketRepository,
} from '../application/ports/ticket.repository';
import { AddCommentUseCase } from '../application/use-cases/add-comment';
import { CreateTicketUseCase } from '../application/use-cases/create-ticket';
import {
  GetTicketUseCase,
  ListTicketsUseCase,
} from '../application/use-cases/ticket-queries';
import {
  AssignTicketUseCase,
  ChangeTicketStatusUseCase,
} from '../application/use-cases/ticket-lifecycle';
import { APP_ENV, SERVICE_NAME, type TicketsServiceEnv } from '../config/env';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import { HttpMembershipVerifier } from '../infrastructure/http/http-membership-verifier';
import { RabbitMqEventPublisher } from '../infrastructure/messaging/rabbitmq-event-publisher';
import { PrismaTicketRepository } from '../infrastructure/prisma/prisma-ticket.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { HealthController } from './health/health.controller';
import { TicketsController } from './tickets/tickets.controller';

/**
 * Root module built from an already-validated environment; ports meet their
 * infrastructure implementations here and nowhere else.
 */
@Module({})
export class AppModule {
  static forRoot(env: TicketsServiceEnv): DynamicModule {
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
      controllers: [HealthController, TicketsController],
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: CLOCK, useClass: SystemClock },
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(env.DATABASE_URL),
        },
        {
          provide: TICKET_REPOSITORY,
          useFactory: (prisma: PrismaService) =>
            new PrismaTicketRepository(prisma),
          inject: [PrismaService],
        },
        {
          // The adapter owns its broker connection; overriding this token in
          // tests keeps them broker-free.
          provide: EVENT_PUBLISHER,
          useFactory: (logger: Logger) =>
            new RabbitMqEventPublisher(
              new MessagingClient({
                url: env.RABBITMQ_URL,
                serviceName: SERVICE_NAME,
                logger,
              }),
              logger,
            ),
          inject: [Logger],
        },
        {
          // Null while unconfigured, mirroring auth-service's resolver — but
          // with the opposite consequence: auth degrades open (tokens minted
          // without tenant claims), assignment fails closed. A missing
          // verifier here means every assignment is refused with 503 until
          // both variables are set.
          provide: MEMBERSHIP_VERIFIER,
          useFactory: (logger: Logger): MembershipVerifier | null => {
            if (!env.ORGANIZATIONS_SERVICE_URL || !env.INTERNAL_SERVICE_TOKEN) {
              logger.warn(
                'ORGANIZATIONS_SERVICE_URL / INTERNAL_SERVICE_TOKEN are not set: ticket assignment will be refused until both are configured',
              );
              return null;
            }
            return new HttpMembershipVerifier(
              env.ORGANIZATIONS_SERVICE_URL,
              env.INTERNAL_SERVICE_TOKEN,
            );
          },
          inject: [Logger],
        },
        {
          provide: CreateTicketUseCase,
          useFactory: (
            tickets: TicketRepository,
            clock: Clock,
            events: EventPublisher,
          ) => new CreateTicketUseCase(tickets, clock, events),
          inject: [TICKET_REPOSITORY, CLOCK, EVENT_PUBLISHER],
        },
        {
          provide: GetTicketUseCase,
          useFactory: (tickets: TicketRepository) =>
            new GetTicketUseCase(tickets),
          inject: [TICKET_REPOSITORY],
        },
        {
          provide: ListTicketsUseCase,
          useFactory: (tickets: TicketRepository) =>
            new ListTicketsUseCase(tickets),
          inject: [TICKET_REPOSITORY],
        },
        {
          provide: ChangeTicketStatusUseCase,
          useFactory: (
            tickets: TicketRepository,
            clock: Clock,
            events: EventPublisher,
          ) => new ChangeTicketStatusUseCase(tickets, clock, events),
          inject: [TICKET_REPOSITORY, CLOCK, EVENT_PUBLISHER],
        },
        {
          provide: AssignTicketUseCase,
          useFactory: (
            tickets: TicketRepository,
            clock: Clock,
            events: EventPublisher,
            memberships: MembershipVerifier | null,
          ) => new AssignTicketUseCase(tickets, clock, events, memberships),
          inject: [
            TICKET_REPOSITORY,
            CLOCK,
            EVENT_PUBLISHER,
            MEMBERSHIP_VERIFIER,
          ],
        },
        {
          provide: AddCommentUseCase,
          useFactory: (
            tickets: TicketRepository,
            clock: Clock,
            events: EventPublisher,
          ) => new AddCommentUseCase(tickets, clock, events),
          inject: [TICKET_REPOSITORY, CLOCK, EVENT_PUBLISHER],
        },
        JwtAccessGuard,
      ],
    };
  }
}
