import {
  aiSuggestionCreatedV2,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  EventPublisher,
  SuggestionCreatedEvent,
} from '../../application/ports/event-publisher';

/**
 * Publishes ai.suggestion.created.v2 to RabbitMQ. Owns its MessagingClient
 * and closes it on application shutdown (Nest calls the hook on the
 * instance).
 *
 * Best-effort delivery: the suggestion is already committed when this runs,
 * so a broker failure is logged and swallowed instead of failing a request
 * whose work succeeded. Accepted trade-off until an outbox exists
 * (ADR 0006). No queue binds this event — the audit service records it
 * through its firehose subscription, and nothing else consumes it yet.
 *
 * v2 is the only published revision since phase 8 closed the dual-publish
 * window; a v1 copy would only pad the audit trail with a second row per
 * fact.
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

    // The skip-and-warn branch the compatibility window needed ("caller has
    // no organization") is gone rather than kept as dead defensive code:
    // generating a suggestion has required an organization on its domain
    // types since the write-path phase, so the state the skip guarded can
    // no longer be constructed. Should the port's still-optional field ever
    // arrive undefined regardless, the envelope goes out tenantless and a
    // tenant-requiring consumer dead-letters it — an inspectable failure,
    // not a silent skip.
    try {
      // The trace id and the organization ride on the envelope, not in the
      // payload: they say which request caused the event and which tenant
      // it belongs to, neither of which is part of the contract's shape.
      await this.messaging.publish(aiSuggestionCreatedV2, payload, {
        ...(event.traceId ? { correlationId: event.traceId } : {}),
        ...(event.organizationId
          ? { organizationId: event.organizationId }
          : {}),
      });
    } catch (error) {
      this.logger?.error(
        `failed to publish ${aiSuggestionCreatedV2.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }
}
