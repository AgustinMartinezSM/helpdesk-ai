import {
  aiSuggestionCreatedV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  EventPublisher,
  SuggestionCreatedEvent,
} from '../../application/ports/event-publisher';

/**
 * Publishes ai.suggestion.created.v1 to RabbitMQ. Owns its MessagingClient
 * and closes it on application shutdown (Nest calls the hook on the
 * instance).
 *
 * Best-effort delivery: the suggestion is already committed when this runs,
 * so a broker failure is logged and swallowed instead of failing a request
 * whose work succeeded. Accepted trade-off until an outbox exists
 * (ADR 0006). The audit service records the event automatically through its
 * firehose subscription; nothing else consumes it yet.
 */
export class RabbitMqEventPublisher implements EventPublisher {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly logger?: MessagingLogger,
  ) {}

  async publishSuggestionCreated(event: SuggestionCreatedEvent): Promise<void> {
    try {
      await this.messaging.publish(
        aiSuggestionCreatedV1,
        {
          suggestionId: event.suggestionId,
          ticketId: event.ticketId,
          task: event.task,
          provider: event.provider,
          model: event.model,
          requestedBy: event.requestedBy,
          createdAt: event.createdAt.toISOString(),
        },
        event.traceId ? { correlationId: event.traceId } : undefined,
      );
    } catch (error) {
      this.logger?.error(
        `failed to publish ${aiSuggestionCreatedV1.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }
}
