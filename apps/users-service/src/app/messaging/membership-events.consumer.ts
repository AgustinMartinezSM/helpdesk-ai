import {
  membershipCreatedV1,
  membershipRoleChangedV1,
  membershipStatusChangedV1,
  requireEnvelopeOrganization,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  ApplyMembershipCreatedUseCase,
  ApplyMembershipRoleChangedUseCase,
  ApplyMembershipStatusChangedUseCase,
} from '../../application/use-cases/apply-membership-events';

/** Durable queue owned by this service (see docs/architecture/messaging.md). */
export const MEMBERSHIP_EVENTS_QUEUE = 'users-service.membership-events';

/**
 * Feeds the directory's membership projection from the lifecycle events
 * organizations-service publishes. prefetch=1 keeps handling serialized;
 * combined with the repository's atomic LWW guard, out-of-order and
 * redelivered events cannot corrupt the projection. Fire-and-forget on
 * bootstrap, like every consumer in the platform: a broker outage delays
 * consumption instead of blocking HTTP startup.
 */
export class MembershipEventsConsumer {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly applyCreated: ApplyMembershipCreatedUseCase,
    private readonly applyStatusChanged: ApplyMembershipStatusChangedUseCase,
    private readonly applyRoleChanged: ApplyMembershipRoleChangedUseCase,
    private readonly logger?: MessagingLogger,
  ) {}

  onApplicationBootstrap(): void {
    void this.start()
      .then(() => {
        this.logger?.log(
          `consuming membership events from ${MEMBERSHIP_EVENTS_QUEUE}`,
        );
      })
      .catch((error: unknown) => {
        this.logger?.error(
          `failed to start the ${MEMBERSHIP_EVENTS_QUEUE} subscription: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /** Resolves once the queue is declared, bound and being consumed. */
  async start(): Promise<void> {
    await this.messaging.subscribe({
      queue: MEMBERSHIP_EVENTS_QUEUE,
      contracts: [
        membershipCreatedV1,
        membershipStatusChangedV1,
        membershipRoleChangedV1,
      ],
      prefetch: 1,
      handler: async (event) => {
        // A tenantless envelope dead-letters instead of projecting a row no
        // organization owns. The row's identity then comes from the PAYLOAD:
        // a membership IS an (organization, user) edge, so the payload
        // carries the organization as the subject of the fact, while the
        // envelope copy exists for consumers that route on tenancy without
        // knowing this schema (see the contract's comment).
        requireEnvelopeOrganization(event);
        switch (event.type) {
          case 'membership.created.v1':
            await this.applyCreated.execute({
              organizationId: event.payload.organizationId,
              userId: event.payload.userId,
              roleTemplate: event.payload.roleTemplate,
              status: event.payload.status,
              occurredAt: new Date(event.payload.createdAt),
            });
            return;
          case 'membership.status-changed.v1':
            await this.applyStatusChanged.execute({
              organizationId: event.payload.organizationId,
              userId: event.payload.userId,
              toStatus: event.payload.toStatus,
              occurredAt: new Date(event.payload.changedAt),
            });
            return;
          case 'membership.role-changed.v1': {
            const applied = await this.applyRoleChanged.execute({
              organizationId: event.payload.organizationId,
              userId: event.payload.userId,
              toTemplate: event.payload.toTemplate,
              occurredAt: new Date(event.payload.changedAt),
            });
            if (!applied) {
              // An unseen edge means the created event was lost. No
              // placeholder row here, unlike status-changed (see the port
              // contract for the asymmetry): this warning plus the backfill
              // script are the recovery path.
              this.logger?.warn(
                `skipped membership.role-changed.v1 for unknown membership ` +
                  `${event.payload.organizationId}/${event.payload.userId}; ` +
                  `backfill-directory-memberships.sh reconciles it`,
              );
            }
            return;
          }
        }
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }
}
