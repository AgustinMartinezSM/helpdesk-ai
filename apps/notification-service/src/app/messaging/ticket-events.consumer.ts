import {
  ticketAssignedV1,
  ticketCommentAddedV1,
  ticketCreatedV1,
  ticketStatusChangedV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  NotifyAssignedUseCase,
  NotifyCommentAddedUseCase,
  NotifyStatusChangedUseCase,
  RegisterTicketRefUseCase,
} from '../../application/use-cases/project-ticket-events';

/** Durable queue owned by this service (see docs/architecture/messaging.md). */
export const TICKET_EVENTS_QUEUE = 'notification-service.ticket-events';

/**
 * Routes ticket lifecycle events into the notification policy.
 *
 * prefetch is 1 ON PURPOSE: it serializes handling, so a ticket's
 * created event (which seeds ticket_refs) is fully projected before the
 * follow-up events of that same ticket are dispatched — with the default
 * prefetch both would run concurrently and the ref lookup could miss.
 * Fire-and-forget on bootstrap, like every consumer in the platform.
 */
export class TicketEventsConsumer {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly registerRef: RegisterTicketRefUseCase,
    private readonly notifyStatusChanged: NotifyStatusChangedUseCase,
    private readonly notifyAssigned: NotifyAssignedUseCase,
    private readonly notifyCommentAdded: NotifyCommentAddedUseCase,
    private readonly logger?: MessagingLogger,
  ) {}

  onApplicationBootstrap(): void {
    void this.start()
      .then(() => {
        this.logger?.log(
          `consuming ticket lifecycle events from ${TICKET_EVENTS_QUEUE}`,
        );
      })
      .catch((error: unknown) => {
        this.logger?.error(
          `failed to start the ${TICKET_EVENTS_QUEUE} subscription: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /** Resolves once the queue is declared, bound and being consumed. */
  async start(): Promise<void> {
    await this.messaging.subscribe({
      queue: TICKET_EVENTS_QUEUE,
      contracts: [
        ticketCreatedV1,
        ticketStatusChangedV1,
        ticketAssignedV1,
        ticketCommentAddedV1,
      ],
      prefetch: 1,
      handler: async (event) => {
        switch (event.type) {
          case 'ticket.created.v1':
            await this.registerRef.execute({
              ticketId: event.payload.ticketId,
              requesterId: event.payload.requesterId,
            });
            return;
          case 'ticket.status-changed.v1':
            await this.notifyStatusChanged.execute({
              sourceEventId: event.id,
              ticketId: event.payload.ticketId,
              actorId: event.payload.actorId,
              fromStatus: event.payload.fromStatus,
              toStatus: event.payload.toStatus,
            });
            return;
          case 'ticket.assigned.v1':
            await this.notifyAssigned.execute({
              sourceEventId: event.id,
              ticketId: event.payload.ticketId,
              actorId: event.payload.actorId,
              assigneeId: event.payload.assigneeId,
            });
            return;
          case 'ticket.comment-added.v1':
            await this.notifyCommentAdded.execute({
              sourceEventId: event.id,
              ticketId: event.payload.ticketId,
              authorId: event.payload.authorId,
              internal: event.payload.internal,
            });
            return;
        }
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }
}
