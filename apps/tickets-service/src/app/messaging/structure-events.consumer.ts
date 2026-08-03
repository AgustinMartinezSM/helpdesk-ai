import {
  branchCreatedV1,
  branchUpdatedV1,
  supportTeamCreatedV1,
  supportTeamScopeChangedV1,
  supportTeamUpdatedV1,
  requireEnvelopeOrganization,
  stationCreatedV1,
  stationUpdatedV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  ApplyBranchEventUseCase,
  ApplyStationEventUseCase,
  ApplyTeamEventUseCase,
  ApplyTeamScopeEventUseCase,
} from '../../application/use-cases/apply-structure-events';

/** Durable queue owned by this service (see docs/architecture/messaging.md). */
export const STRUCTURE_EVENTS_QUEUE = 'tickets-service.structure-events';

/**
 * This service's FIRST consumer: feeds the branch_refs/station_refs
 * projection from the structure events organizations-service publishes, so
 * ticket creation can validate branch context locally (D4) instead of
 * asking synchronously. prefetch=1 keeps handling serialized; combined with
 * the repository's atomic LWW guard, out-of-order and redelivered events
 * cannot corrupt the projection. Fire-and-forget on bootstrap, like every
 * consumer in the platform: a broker outage delays consumption instead of
 * blocking HTTP startup — and creation fails closed against the projection
 * meanwhile, which is the direction D4 chose.
 */
export class StructureEventsConsumer {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly applyBranch: ApplyBranchEventUseCase,
    private readonly applyStation: ApplyStationEventUseCase,
    private readonly applyTeam: ApplyTeamEventUseCase,
    private readonly applyTeamScope: ApplyTeamScopeEventUseCase,
    private readonly logger?: MessagingLogger,
  ) {}

  onApplicationBootstrap(): void {
    void this.start()
      .then(() => {
        this.logger?.log(
          `consuming structure events from ${STRUCTURE_EVENTS_QUEUE}`,
        );
      })
      .catch((error: unknown) => {
        this.logger?.error(
          `failed to start the ${STRUCTURE_EVENTS_QUEUE} subscription: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /** Resolves once the queue is declared, bound and being consumed. */
  async start(): Promise<void> {
    await this.messaging.subscribe({
      queue: STRUCTURE_EVENTS_QUEUE,
      contracts: [
        branchCreatedV1,
        branchUpdatedV1,
        stationCreatedV1,
        stationUpdatedV1,
        supportTeamCreatedV1,
        supportTeamUpdatedV1,
        supportTeamScopeChangedV1,
      ],
      prefetch: 1,
      handler: async (event) => {
        // A tenantless envelope dead-letters instead of projecting a row no
        // organization owns. The row's identity then comes from the
        // PAYLOAD: a branch belongs to exactly one organization by
        // construction, so the payload states the fact, while the envelope
        // copy exists for consumers that route on tenancy without knowing
        // this schema (see the contract's comment).
        requireEnvelopeOrganization(event);
        // created uses the payload's createdAt and updated its updatedAt as
        // the LWW key: >= wins in the repository, so a replay of either is
        // safe and a stale one is ignored.
        switch (event.type) {
          case 'support-team.created.v1':
            await this.applyTeam.execute({
              teamId: event.payload.teamId,
              organizationId: event.payload.organizationId,
              name: event.payload.name,
              status: event.payload.status,
              occurredAt: new Date(event.payload.createdAt),
            });
            return;
          case 'support-team.updated.v1':
            await this.applyTeam.execute({
              teamId: event.payload.teamId,
              organizationId: event.payload.organizationId,
              name: event.payload.name,
              status: event.payload.status,
              occurredAt: new Date(event.payload.updatedAt),
            });
            return;
          case 'support-team.scope-changed.v1':
            // An EMPTY branchIds is the organization-wide case and is applied
            // as such: treating it as "nothing to do" would leave a widened
            // team still narrowed here, which is the one drift that would
            // hide work from the people who should get it.
            await this.applyTeamScope.execute({
              teamId: event.payload.teamId,
              organizationId: event.payload.organizationId,
              branchIds: [...event.payload.branchIds],
              occurredAt: new Date(event.payload.changedAt),
            });
            return;
          case 'branch.created.v1':
            await this.applyBranch.execute({
              branchId: event.payload.branchId,
              organizationId: event.payload.organizationId,
              code: event.payload.code,
              name: event.payload.name,
              status: event.payload.status,
              occurredAt: new Date(event.payload.createdAt),
            });
            return;
          case 'branch.updated.v1':
            await this.applyBranch.execute({
              branchId: event.payload.branchId,
              organizationId: event.payload.organizationId,
              code: event.payload.code,
              name: event.payload.name,
              status: event.payload.status,
              occurredAt: new Date(event.payload.updatedAt),
            });
            return;
          case 'station.created.v1':
            await this.applyStation.execute({
              stationId: event.payload.stationId,
              branchId: event.payload.branchId,
              organizationId: event.payload.organizationId,
              code: event.payload.code,
              name: event.payload.name,
              area: event.payload.area ?? null,
              status: event.payload.status,
              occurredAt: new Date(event.payload.createdAt),
            });
            return;
          case 'station.updated.v1':
            await this.applyStation.execute({
              stationId: event.payload.stationId,
              branchId: event.payload.branchId,
              organizationId: event.payload.organizationId,
              code: event.payload.code,
              name: event.payload.name,
              area: event.payload.area ?? null,
              status: event.payload.status,
              occurredAt: new Date(event.payload.updatedAt),
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
