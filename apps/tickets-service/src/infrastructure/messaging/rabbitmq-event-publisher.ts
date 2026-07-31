import {
  ticketAssignedV2,
  ticketCommentAddedV2,
  ticketCreatedV2,
  ticketStatusChangedV2,
  type EventContract,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  EventCorrelation,
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
 *
 * v2 is the only published revision since phase 8 closed the dual-publish
 * window: nothing binds the v1 routing keys any more, so a v1 copy would
 * reach no queue and only pad the audit trail with a second row per fact.
 */
export class RabbitMqEventPublisher implements EventPublisher {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly logger?: MessagingLogger,
  ) {}

  async publishTicketCreated(event: TicketCreatedEvent): Promise<void> {
    await this.publishScoped(ticketCreatedV2, event, {
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
    await this.publishScoped(ticketStatusChangedV2, event, {
      ticketId: event.ticketId,
      actorId: event.actorId,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      changedAt: event.changedAt.toISOString(),
    });
  }

  async publishTicketAssigned(event: TicketAssignedEvent): Promise<void> {
    await this.publishScoped(ticketAssignedV2, event, {
      ticketId: event.ticketId,
      actorId: event.actorId,
      assigneeId: event.assigneeId,
      assignedAt: event.assignedAt.toISOString(),
    });
  }

  async publishTicketCommentAdded(
    event: TicketCommentAddedEvent,
  ): Promise<void> {
    await this.publishScoped(ticketCommentAddedV2, event, {
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

  /**
   * Publishes the v2 contract with the caller's tenant on the envelope,
   * best-effort: a broker failure is logged, never rethrown.
   *
   * The skip-and-warn branch the compatibility window needed ("caller has
   * no organization") is gone rather than kept as dead defensive code:
   * every ticket write has required an organization on its domain types
   * since the write-path phase, so the state the skip guarded can no longer
   * be constructed. Should the port's still-optional field ever arrive
   * undefined regardless, the envelope goes out tenantless and the
   * consumers' requireEnvelopeOrganization dead-letters it — an inspectable
   * failure, not a silent skip.
   */
  private async publishScoped<TType extends string, TPayload>(
    contract: EventContract<TType, TPayload>,
    event: EventCorrelation,
    payload: TPayload,
  ): Promise<void> {
    try {
      // The trace id and the organization ride on the envelope, not in the
      // payload: they say which request caused the event and which tenant it
      // belongs to, neither of which is part of any one contract's shape.
      await this.messaging.publish(contract, payload, {
        ...(event.traceId ? { correlationId: event.traceId } : {}),
        ...(event.organizationId
          ? { organizationId: event.organizationId }
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
