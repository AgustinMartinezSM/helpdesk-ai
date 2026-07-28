import {
  userRegisteredV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  EventPublisher,
  UserRegisteredEvent,
} from '../../application/ports/event-publisher';

/**
 * Publishes auth domain events to RabbitMQ. Owns its MessagingClient and
 * closes it on application shutdown (Nest calls the hook on the instance).
 *
 * Best-effort delivery: the registration already committed when this runs,
 * so a broker failure is logged and swallowed instead of failing the
 * request. Accepted trade-off until an outbox exists (ADR 0005).
 */
export class RabbitMqEventPublisher implements EventPublisher {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly logger?: MessagingLogger,
  ) {}

  async publishUserRegistered(event: UserRegisteredEvent): Promise<void> {
    try {
      await this.messaging.publish(userRegisteredV1, {
        userId: event.userId,
        email: event.email,
        roles: event.roles,
        registeredAt: event.registeredAt.toISOString(),
      });
    } catch (error) {
      this.logger?.error(
        `failed to publish ${userRegisteredV1.type} for user ${event.userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }
}
