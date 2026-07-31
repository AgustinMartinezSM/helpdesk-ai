import {
  membershipCreatedV1,
  requireEnvelopeOrganization,
  ticketCreatedV2,
  ticketStatusChangedV2,
  userRegisteredV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  ApplyMembershipCreatedUseCase,
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
    private readonly applyMembershipCreated: ApplyMembershipCreatedUseCase,
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
      contracts: [
        ticketCreatedV2,
        ticketStatusChangedV2,
        userRegisteredV1,
        membershipCreatedV1,
      ],
      // Historical routing keys, as string literals ON PURPOSE: the v1
      // contracts were deleted in phase 8, so there is no identifier left
      // to reference — only the keys this durable queue was once bound to.
      // Every boot unbinds them (idempotently), which is what allowed the
      // v1 ack-as-no-op arms to leave the handler. Removable once every
      // environment's durable queue has booted past this version.
      retiredBindingKeys: ['ticket.created.v1', 'ticket.status-changed.v1'],
      prefetch: 1,
      handler: async (event) => {
        switch (event.type) {
          case 'ticket.created.v2': {
            // Throwing on a tenantless v2 envelope dead-letters it: better
            // an inspectable dead letter than a row no organization owns.
            const organizationId = requireEnvelopeOrganization(event);
            await this.applyCreated.execute({
              ticketId: event.payload.ticketId,
              organizationId,
              status: event.payload.status,
              priority: event.payload.priority,
              createdAt: new Date(event.payload.createdAt),
              occurredAt: new Date(event.occurredAt),
            });
            return;
          }
          case 'ticket.status-changed.v2': {
            const organizationId = requireEnvelopeOrganization(event);
            await this.applyStatusChanged.execute({
              ticketId: event.payload.ticketId,
              organizationId,
              toStatus: event.payload.toStatus,
              changedAt: new Date(event.payload.changedAt),
              occurredAt: new Date(event.occurredAt),
            });
            return;
          }
          case 'user.registered.v1':
            // Deliberately tenantless: registration is anonymous, and the
            // membership event that follows stamps the organization.
            await this.applyRegistered.execute({
              userId: event.payload.userId,
              registeredAt: new Date(event.payload.registeredAt),
            });
            return;
          case 'membership.created.v1':
            // Guard on the envelope like every tenant-carrying contract;
            // what gets stamped is the payload copy, because a membership
            // IS an (organization, user) edge — the organization is the
            // subject of the fact, not merely the scope of its delivery.
            requireEnvelopeOrganization(event);
            await this.applyMembershipCreated.execute({
              userId: event.payload.userId,
              organizationId: event.payload.organizationId,
              createdAt: new Date(event.payload.createdAt),
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
