import {
  requireEnvelopeOrganization,
  ticketAssignedV1,
  ticketAssignedV2,
  ticketCommentAddedV1,
  ticketCommentAddedV2,
  ticketCreatedV1,
  ticketCreatedV2,
  ticketStatusChangedV1,
  ticketStatusChangedV2,
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
        ticketCreatedV2,
        ticketStatusChangedV1,
        ticketStatusChangedV2,
        ticketAssignedV1,
        ticketAssignedV2,
        ticketCommentAddedV1,
        ticketCommentAddedV2,
      ],
      prefetch: 1,
      handler: async (event) => {
        switch (event.type) {
          // The v1 cases are explicit no-op acks, not removed bindings: this
          // client only ever binds, never unbinds, so the durable queue keeps
          // its v1 bindings until the phase-8 queue surgery. Processing both
          // versions would notify twice under two envelope ids — the
          // (userId, sourceEventId) dedupe key cannot collapse two different
          // envelopes. And since every ticket write requires an organization,
          // every v1 fact has a v2 twin on this same queue: acking v1 loses
          // nothing.
          case 'ticket.created.v1':
          case 'ticket.status-changed.v1':
          case 'ticket.assigned.v1':
          case 'ticket.comment-added.v1':
            return;
          case 'ticket.created.v2':
            await this.registerRef.execute({
              ticketId: event.payload.ticketId,
              requesterId: event.payload.requesterId,
              organizationId: requireEnvelopeOrganization(event),
            });
            return;
          case 'ticket.status-changed.v2':
            await this.notifyStatusChanged.execute({
              sourceEventId: event.id,
              ticketId: event.payload.ticketId,
              organizationId: requireEnvelopeOrganization(event),
              actorId: event.payload.actorId,
              fromStatus: event.payload.fromStatus,
              toStatus: event.payload.toStatus,
            });
            return;
          case 'ticket.assigned.v2':
            await this.notifyAssigned.execute({
              sourceEventId: event.id,
              ticketId: event.payload.ticketId,
              organizationId: requireEnvelopeOrganization(event),
              actorId: event.payload.actorId,
              assigneeId: event.payload.assigneeId,
            });
            return;
          case 'ticket.comment-added.v2':
            await this.notifyCommentAdded.execute({
              sourceEventId: event.id,
              ticketId: event.payload.ticketId,
              organizationId: requireEnvelopeOrganization(event),
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
