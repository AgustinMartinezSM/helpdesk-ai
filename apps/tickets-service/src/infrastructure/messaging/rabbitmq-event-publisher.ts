import {
  ticketAssignedV1,
  ticketCommentAddedV1,
  ticketCreatedV1,
  ticketStatusChangedV1,
  type EventContract,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  EventPublisher,
  TicketAssignedEvent,
  TicketCommentAddedEvent,
  TicketCreatedEvent,
  TicketStatusChangedEvent,
} from '../../application/ports/event-publisher';

/**
 * Publishes ticket domain events to RabbitMQ. Owns its MessagingClient and
 * closes it on application shutdown (Nest calls the hook on the instance).
 *
 * Best-effort delivery: the mutation already committed when this runs, so
 * a broker failure is logged and swallowed instead of failing the request.
 * Accepted trade-off until an outbox exists (ADR 0005).
 */
export class RabbitMqEventPublisher implements EventPublisher {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly logger?: MessagingLogger,
  ) {}

  async publishTicketCreated(event: TicketCreatedEvent): Promise<void> {
    await this.safePublish(ticketCreatedV1, {
      ticketId: event.ticketId,
      requesterId: event.requesterId,
      title: event.title,
      priority: event.priority,
      status: event.status,
      createdAt: event.createdAt.toISOString(),
    });
  }

  async publishTicketStatusChanged(
    event: TicketStatusChangedEvent,
  ): Promise<void> {
    await this.safePublish(ticketStatusChangedV1, {
      ticketId: event.ticketId,
      actorId: event.actorId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      changedAt: event.changedAt.toISOString(),
    });
  }

  async publishTicketAssigned(event: TicketAssignedEvent): Promise<void> {
    await this.safePublish(ticketAssignedV1, {
      ticketId: event.ticketId,
      actorId: event.actorId,
      assigneeId: event.assigneeId,
      assignedAt: event.assignedAt.toISOString(),
    });
  }

  async publishTicketCommentAdded(
    event: TicketCommentAddedEvent,
  ): Promise<void> {
    await this.safePublish(ticketCommentAddedV1, {
      ticketId: event.ticketId,
      commentId: event.commentId,
      authorId: event.authorId,
      internal: event.internal,
      addedAt: event.addedAt.toISOString(),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }

  private async safePublish<TType extends string, TPayload>(
    contract: EventContract<TType, TPayload>,
    payload: TPayload,
  ): Promise<void> {
    try {
      await this.messaging.publish(contract, payload);
    } catch (error) {
      this.logger?.error(
        `failed to publish ${contract.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
