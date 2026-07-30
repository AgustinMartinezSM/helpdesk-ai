import {
  ticketAssignedV1,
  ticketAssignedV2,
  ticketCommentAddedV1,
  ticketCommentAddedV2,
  ticketCreatedV1,
  ticketCreatedV2,
  ticketStatusChangedV1,
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
 * Every event goes out twice during the migration: v1 unchanged for the
 * consumers reading it today, and v2 carrying the organization on its
 * envelope for the consumers that will. The two versions differ only in
 * their type string, which is the routing key — so no existing queue ever
 * receives a v2, and nothing downstream moves until it binds one.
 */
export class RabbitMqEventPublisher implements EventPublisher {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly logger?: MessagingLogger,
  ) {}

  async publishTicketCreated(event: TicketCreatedEvent): Promise<void> {
    await this.publishBothVersions(ticketCreatedV1, ticketCreatedV2, event, {
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
    await this.publishBothVersions(
      ticketStatusChangedV1,
      ticketStatusChangedV2,
      event,
      {
        ticketId: event.ticketId,
        actorId: event.actorId,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        changedAt: event.changedAt.toISOString(),
      },
    );
  }

  async publishTicketAssigned(event: TicketAssignedEvent): Promise<void> {
    await this.publishBothVersions(ticketAssignedV1, ticketAssignedV2, event, {
      ticketId: event.ticketId,
      actorId: event.actorId,
      assigneeId: event.assigneeId,
      assignedAt: event.assignedAt.toISOString(),
    });
  }

  async publishTicketCommentAdded(
    event: TicketCommentAddedEvent,
  ): Promise<void> {
    await this.publishBothVersions(
      ticketCommentAddedV1,
      ticketCommentAddedV2,
      event,
      {
        ticketId: event.ticketId,
        commentId: event.commentId,
        authorId: event.authorId,
        internal: event.internal,
        addedAt: event.addedAt.toISOString(),
      },
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }

  /**
   * Publishes the compatibility pair from one payload object.
   *
   * The payload is built once by the caller and handed to both versions, so
   * the two cannot drift into describing the same fact differently.
   *
   * v1 goes out unconditionally. v2 goes out only when a tenant is known,
   * because the point of v2 is that it carries one — a v2 event without an
   * organization is exactly what the consumers of the next phase are meant to
   * be able to reject, so producing one would defeat the migration rather
   * than advance it. Nothing in the messaging library enforces that: it
   * validates payloads and never envelopes, so the check has to be here,
   * where the reason for a missing tenant is still known and can be named.
   *
   * The skip is logged rather than swallowed. A caller with no organization
   * means a token minted while organizations-service was unavailable, or a
   * user whose membership has not been backfilled — both are conditions an
   * operator has to see before the next phase starts rejecting on them.
   */
  private async publishBothVersions<TType extends string, TPayload>(
    v1: EventContract<TType, TPayload>,
    v2: EventContract<string, TPayload>,
    event: EventCorrelation & { ticketId: string },
    payload: TPayload,
  ): Promise<void> {
    await this.safePublish(v1, payload, { correlationId: event.traceId });

    if (!event.organizationId) {
      this.logger?.warn(
        `skipping ${v2.type} for ticket ${event.ticketId}: the caller has no organization`,
      );
      return;
    }

    // Same correlationId as the v1 publish, deliberately: the two envelopes
    // are one fact and the trace id is the only thing that groups them,
    // including in the audit trail, which stores both.
    await this.safePublish(v2, payload, {
      correlationId: event.traceId,
      organizationId: event.organizationId,
    });
  }

  private async safePublish<TType extends string, TPayload>(
    contract: EventContract<TType, TPayload>,
    payload: TPayload,
    options: { correlationId?: string; organizationId?: string },
  ): Promise<void> {
    try {
      // The trace id and the organization ride on the envelope, not in the
      // payload: they say which request caused the event and which tenant it
      // belongs to, neither of which is part of any one contract's shape.
      // Omitted rather than faked when the caller had none.
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
