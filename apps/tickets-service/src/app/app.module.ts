import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ObservabilityModule } from '@helpdesk-ai/observability';
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
import { PrismaTicketRepository } from '../infrastructure/prisma/prisma-ticket.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { JwtAccessGuard } from './guards/jwt-access.guard';
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
          provide: CreateTicketUseCase,
          useFactory: (tickets: TicketRepository, clock: Clock) =>
            new CreateTicketUseCase(tickets, clock),
          inject: [TICKET_REPOSITORY, CLOCK],
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
          useFactory: (tickets: TicketRepository, clock: Clock) =>
            new ChangeTicketStatusUseCase(tickets, clock),
          inject: [TICKET_REPOSITORY, CLOCK],
        },
        {
          provide: AssignTicketUseCase,
          useFactory: (tickets: TicketRepository, clock: Clock) =>
            new AssignTicketUseCase(tickets, clock),
          inject: [TICKET_REPOSITORY, CLOCK],
        },
        {
          provide: AddCommentUseCase,
          useFactory: (tickets: TicketRepository, clock: Clock) =>
            new AddCommentUseCase(tickets, clock),
          inject: [TICKET_REPOSITORY, CLOCK],
        },
        JwtAccessGuard,
      ],
    };
  }
}
