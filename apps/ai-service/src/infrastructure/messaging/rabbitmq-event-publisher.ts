import {
  aiSuggestionCreatedV1,
  aiSuggestionCreatedV2,
  type EventContract,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  EventPublisher,
  SuggestionCreatedEvent,
} from '../../application/ports/event-publisher';

/**
 * Publishes the ai.suggestion.created compatibility pair to RabbitMQ. Owns
 * its MessagingClient and closes it on application shutdown (Nest calls the
 * hook on the instance).
 *
 * Best-effort delivery: the suggestion is already committed when this runs,
 * so a broker failure is logged and swallowed instead of failing a request
 * whose work succeeded. Accepted trade-off until an outbox exists
 * (ADR 0006). No queue binds either version — the audit service records both
 * through its firehose subscription, and nothing else consumes them yet.
 */
export class RabbitMqEventPublisher implements EventPublisher {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly logger?: MessagingLogger,
  ) {}

  async publishSuggestionCreated(event: SuggestionCreatedEvent): Promise<void> {
    const payload = {
      suggestionId: event.suggestionId,
      ticketId: event.ticketId,
      task: event.task,
      provider: event.provider,
      model: event.model,
      requestedBy: event.requestedBy,
      createdAt: event.createdAt.toISOString(),
    };

    await this.safePublish(aiSuggestionCreatedV1, payload, {
      correlationId: event.traceId,
    });

    if (!event.organizationId) {
      // A v2 event exists to carry a tenant, so one without a tenant would
      // defeat the migration rather than advance it. The skip is logged
      // because it means the requesting staff member's token was minted with
      // no organization, which an operator has to see before the next phase
      // starts rejecting on it.
      this.logger?.warn(
        `skipping ${aiSuggestionCreatedV2.type} for suggestion ${event.suggestionId}: the caller has no organization`,
      );
      return;
    }

    // Same correlationId as the v1 publish: the two envelopes are one fact,
    // and the trace id is the only thing that groups them in the audit trail,
    // which stores both.
    await this.safePublish(aiSuggestionCreatedV2, payload, {
      correlationId: event.traceId,
      organizationId: event.organizationId,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }

  private async safePublish<TType extends string, TPayload>(
    contract: EventContract<TType, TPayload>,
    payload: TPayload,
    options: { correlationId?: string; organizationId?: string },
  ): Promise<void> {
    try {
      await this.messaging.publish(contract, payload, {
        ...(options.correlationId
          ? { correlationId: options.correlationId }
          : {}),
        ...(options.organizationId
          ? { organizationId: options.organizationId }
          : {}),
      });
    } catch (error) {
      this.logger?.error(
        `failed to publish ${contract.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
