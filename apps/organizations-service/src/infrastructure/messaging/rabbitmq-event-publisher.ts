import {
  branchCreatedV1,
  branchUpdatedV1,
  membershipCreatedV1,
  membershipRoleChangedV1,
  membershipStatusChangedV1,
  stationCreatedV1,
  stationUpdatedV1,
  type EventContract,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type { OrganizationEventPublisher } from '../../application/ports/event-publisher';
import type { Branch, OperationalStation } from '../../domain/branch';
import type {
  Membership,
  MembershipStatus,
  RoleTemplate,
} from '../../domain/membership';

/**
 * Publishes membership and structure domain events to RabbitMQ.
 *
 * Best-effort delivery: the mutation already committed when this runs, so a
 * broker failure is logged and swallowed instead of failing the request.
 * Accepted trade-off until an outbox exists (ADR 0006).
 *
 * The envelope organizationId is ALWAYS set. These contracts are born
 * tenant-carrying, and neither a membership nor a branch nor a station
 * without an organization can exist — the columns are non-null (stations
 * derive theirs through the branch) and the domain types agree — so unlike
 * the ticket v2 dual-publish there is no skip case here: an absent tenant
 * would be a bug to surface, not a state to tolerate.
 *
 * Unlike the tickets-service adapter, this one does not own its
 * MessagingClient: the service has a single shared client (the registration
 * consumer subscribes on it) and RegistrationConsumer closes it on shutdown.
 * A second connection here would double the broker footprint for no
 * isolation gain, and a second close would make ownership ambiguous.
 */
export class RabbitMqEventPublisher implements OrganizationEventPublisher {
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

  async membershipRoleChanged(
    membership: Membership,
    fromTemplate: RoleTemplate,
    correlationId?: string,
  ): Promise<void> {
    await this.safePublish(
      membershipRoleChangedV1,
      {
        membershipId: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
        fromTemplate,
        toTemplate: membership.roleTemplate,
        version: membership.version,
        changedAt: membership.updatedAt.toISOString(),
      },
      membership.organizationId,
      correlationId,
    );
  }

  async branchCreated(branch: Branch, correlationId?: string): Promise<void> {
    await this.safePublish(
      branchCreatedV1,
      {
        branchId: branch.id,
        organizationId: branch.organizationId,
        code: branch.code,
        name: branch.name,
        status: branch.status,
        // Omitted rather than null: the contract models "never set" as
        // absence, and z.optional() does not admit null.
        ...(branch.timezone !== null ? { timezone: branch.timezone } : {}),
        createdAt: branch.createdAt.toISOString(),
      },
      branch.organizationId,
      correlationId,
    );
  }

  async branchUpdated(branch: Branch, correlationId?: string): Promise<void> {
    await this.safePublish(
      branchUpdatedV1,
      {
        branchId: branch.id,
        organizationId: branch.organizationId,
        code: branch.code,
        name: branch.name,
        status: branch.status,
        ...(branch.timezone !== null ? { timezone: branch.timezone } : {}),
        updatedAt: branch.updatedAt.toISOString(),
      },
      branch.organizationId,
      correlationId,
    );
  }

  async stationCreated(
    station: OperationalStation,
    correlationId?: string,
  ): Promise<void> {
    await this.safePublish(
      stationCreatedV1,
      {
        stationId: station.id,
        branchId: station.branchId,
        organizationId: station.organizationId,
        code: station.code,
        name: station.name,
        ...(station.area !== null ? { area: station.area } : {}),
        status: station.status,
        createdAt: station.createdAt.toISOString(),
      },
      station.organizationId,
      correlationId,
    );
  }

  async stationUpdated(
    station: OperationalStation,
    correlationId?: string,
  ): Promise<void> {
    await this.safePublish(
      stationUpdatedV1,
      {
        stationId: station.id,
        branchId: station.branchId,
        organizationId: station.organizationId,
        code: station.code,
        name: station.name,
        ...(station.area !== null ? { area: station.area } : {}),
        status: station.status,
        updatedAt: station.updatedAt.toISOString(),
      },
      station.organizationId,
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
