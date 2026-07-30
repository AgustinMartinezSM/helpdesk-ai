import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MessagingClient } from '@helpdesk-ai/messaging';
import { Logger, ObservabilityModule } from '@helpdesk-ai/observability';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import { AI_PROVIDER, type AiProvider } from '../application/ports/ai-provider';
import {
  EVENT_PUBLISHER,
  type EventPublisher,
} from '../application/ports/event-publisher';
import {
  CLOCK,
  SUGGESTION_REPOSITORY,
  SystemClock,
  type Clock,
  type SuggestionRepository,
} from '../application/ports/suggestion.repository';
import {
  TICKET_SOURCE,
  type TicketSource,
} from '../application/ports/ticket-source';
import { GenerateSuggestionUseCase } from '../application/use-cases/generate-suggestion';
import {
  GetSuggestionHistoryUseCase,
  ListSuggestionsUseCase,
} from '../application/use-cases/suggestion-queries';
import { APP_ENV, SERVICE_NAME, type AiServiceEnv } from '../config/env';
import { registerSecret } from '../domain/redaction';
import { HttpTicketSource } from '../infrastructure/http/http-ticket-source';
import { RabbitMqEventPublisher } from '../infrastructure/messaging/rabbitmq-event-publisher';
import { PrismaSuggestionRepository } from '../infrastructure/prisma/prisma-suggestion.repository';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { createAiProvider } from '../infrastructure/providers/provider.factory';
import { HealthController } from './health/health.controller';
import { SuggestionsController } from './suggestions/suggestions.controller';

/**
 * Root module built from an already-validated environment; ports meet their
 * infrastructure implementations here and nowhere else.
 *
 * The model provider is one factory call (`createAiProvider`), which is what
 * makes connecting a paid provider a change to configuration and one adapter
 * rather than a change to this graph (ADR 0010).
 */
@Module({})
export class AppModule {
  static forRoot(env: AiServiceEnv): DynamicModule {
    // Before anything can fail: from here on, every domain error built
    // anywhere in the service has the configured key stripped out of its
    // message, including on paths that never touch the provider adapter
    // (`domain/redaction.ts`). Every entry point — main and the integration
    // tests — goes through this method, so there is no second place to
    // remember.
    registerSecret(env.GEMINI_API_KEY);

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
      controllers: [HealthController, SuggestionsController],
      providers: [
        { provide: APP_ENV, useValue: env },
        { provide: CLOCK, useClass: SystemClock },
        {
          provide: PrismaService,
          useFactory: () => new PrismaService(env.DATABASE_URL),
        },
        {
          provide: AI_PROVIDER,
          useFactory: () => createAiProvider(env),
        },
        {
          provide: TICKET_SOURCE,
          useFactory: () => new HttpTicketSource(env.TICKETS_SERVICE_URL),
        },
        {
          provide: SUGGESTION_REPOSITORY,
          useFactory: (prisma: PrismaService, logger: Logger) =>
            new PrismaSuggestionRepository(prisma, logger),
          inject: [PrismaService, Logger],
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
          provide: EVENT_PUBLISHER,
          useFactory: (messaging: MessagingClient, logger: Logger) =>
            new RabbitMqEventPublisher(messaging, logger),
          inject: [MessagingClient, Logger],
        },
        {
          provide: GenerateSuggestionUseCase,
          useFactory: (
            tickets: TicketSource,
            provider: AiProvider,
            suggestions: SuggestionRepository,
            events: EventPublisher,
            clock: Clock,
          ) =>
            new GenerateSuggestionUseCase(
              tickets,
              provider,
              suggestions,
              events,
              clock,
            ),
          inject: [
            TICKET_SOURCE,
            AI_PROVIDER,
            SUGGESTION_REPOSITORY,
            EVENT_PUBLISHER,
            CLOCK,
          ],
        },
        {
          provide: ListSuggestionsUseCase,
          useFactory: (suggestions: SuggestionRepository) =>
            new ListSuggestionsUseCase(suggestions),
          inject: [SUGGESTION_REPOSITORY],
        },
        {
          provide: GetSuggestionHistoryUseCase,
          useFactory: (suggestions: SuggestionRepository) =>
            new GetSuggestionHistoryUseCase(suggestions),
          inject: [SUGGESTION_REPOSITORY],
        },
        JwtAccessGuard,
      ],
    };
  }
}
