import {
  membershipCreatedV1,
  membershipStatusChangedV1,
  type EventContract,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type { MembershipEventPublisher } from '../../application/ports/event-publisher';
import type { Membership, MembershipStatus } from '../../domain/membership';

/**
 * Publishes membership domain events to RabbitMQ.
 *
 * Best-effort delivery: the mutation already committed when this runs, so a
 * broker failure is logged and swallowed instead of failing the request.
 * Accepted trade-off until an outbox exists (ADR 0006).
 *
 * The envelope organizationId is ALWAYS set. These contracts are born
 * tenant-carrying, and a membership without an organization cannot exist —
 * the column is non-null and the domain type agrees — so unlike the ticket
 * v2 dual-publish there is no skip case here: an absent tenant would be a
 * bug to surface, not a state to tolerate.
 *
 * Unlike the tickets-service adapter, this one does not own its
 * MessagingClient: the service has a single shared client (the registration
 * consumer subscribes on it) and RegistrationConsumer closes it on shutdown.
 * A second connection here would double the broker footprint for no
 * isolation gain, and a second close would make ownership ambiguous.
 */
export class RabbitMqEventPublisher implements MembershipEventPublisher {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly logger?: MessagingLogger,
  ) {}

  async membershipCreated(
    membership: Membership,
    correlationId?: string,
  ): Promise<void> {
    await this.safePublish(
      membershipCreatedV1,
      {
        membershipId: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
        roleTemplate: membership.roleTemplate,
        status: membership.status,
        createdAt: membership.createdAt.toISOString(),
      },
      membership.organizationId,
      correlationId,
    );
  }

  async membershipStatusChanged(
    membership: Membership,
    fromStatus: MembershipStatus,
    correlationId?: string,
  ): Promise<void> {
    await this.safePublish(
      membershipStatusChangedV1,
      {
        membershipId: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
        fromStatus,
        toStatus: membership.status,
        version: membership.version,
        changedAt: membership.updatedAt.toISOString(),
      },
      membership.organizationId,
      correlationId,
    );
  }

  private async safePublish<TType extends string, TPayload>(
    contract: EventContract<TType, TPayload>,
    payload: TPayload,
    organizationId: string,
    correlationId?: string,
  ): Promise<void> {
    try {
      await this.messaging.publish(contract, payload, {
        organizationId,
        ...(correlationId ? { correlationId } : {}),
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
