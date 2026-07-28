import {
  ticketCreatedV1,
  ticketStatusChangedV1,
  userRegisteredV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  ApplyTicketCreatedUseCase,
  ApplyTicketStatusChangedUseCase,
  ApplyUserRegisteredUseCase,
} from '../../application/use-cases/apply-events';

/** Durable queue owned by this service (see docs/architecture/messaging.md). */
export const METRICS_QUEUE = 'analytics-service.metrics';

/**
 * Feeds the dashboard projections. prefetch=1 keeps handling serialized;
 * combined with the repository's atomic LWW guard, out-of-order and
 * redelivered events cannot corrupt the snapshots. Fire-and-forget on
 * bootstrap, like every consumer in the platform.
 */
export class MetricsConsumer {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly applyCreated: ApplyTicketCreatedUseCase,
    private readonly applyStatusChanged: ApplyTicketStatusChangedUseCase,
    private readonly applyRegistered: ApplyUserRegisteredUseCase,
    private readonly logger?: MessagingLogger,
  ) {}

  onApplicationBootstrap(): void {
    void this.start()
      .then(() => {
        this.logger?.log(`consuming metric events from ${METRICS_QUEUE}`);
      })
      .catch((error: unknown) => {
        this.logger?.error(
          `failed to start the ${METRICS_QUEUE} subscription: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /** Resolves once the queue is declared, bound and being consumed. */
  async start(): Promise<void> {
    await this.messaging.subscribe({
      queue: METRICS_QUEUE,
      contracts: [ticketCreatedV1, ticketStatusChangedV1, userRegisteredV1],
      prefetch: 1,
      handler: async (event) => {
        switch (event.type) {
          case 'ticket.created.v1':
            await this.applyCreated.execute({
              ticketId: event.payload.ticketId,
              status: event.payload.status,
              priority: event.payload.priority,
              createdAt: new Date(event.payload.createdAt),
              occurredAt: new Date(event.occurredAt),
            });
            return;
          case 'ticket.status-changed.v1':
            await this.applyStatusChanged.execute({
              ticketId: event.payload.ticketId,
              toStatus: event.payload.toStatus,
              changedAt: new Date(event.payload.changedAt),
              occurredAt: new Date(event.occurredAt),
            });
            return;
          case 'user.registered.v1':
            await this.applyRegistered.execute({
              userId: event.payload.userId,
              registeredAt: new Date(event.payload.registeredAt),
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
