import type {
  EventContract,
  EventSubscription,
  MessagingClient,
} from '@helpdesk-ai/messaging';
import {
  branchCreatedV1,
  branchUpdatedV1,
  MissingTenantContextError,
  stationCreatedV1,
  stationUpdatedV1,
  supportTeamCreatedV1,
  supportTeamScopeChangedV1,
  supportTeamUpdatedV1,
} from '@helpdesk-ai/messaging';
import {
  ApplyBranchEventUseCase,
  ApplyStationEventUseCase,
  ApplyTeamEventUseCase,
  ApplyTeamScopeEventUseCase,
} from '../../application/use-cases/apply-structure-events';
import {
  InMemoryBranchRefRepository,
  InMemoryStationRefRepository,
  InMemoryTeamRefRepository,
} from '../../application/testing/fakes';
import {
  StructureEventsConsumer,
  STRUCTURE_EVENTS_QUEUE,
} from './structure-events.consumer';

type AnySubscription = EventSubscription<EventContract<string, unknown>>;

class CapturingMessagingClient {
  subscription?: AnySubscription;
  closed = false;

  async subscribe(subscription: AnySubscription): Promise<void> {
    this.subscription = subscription;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRANCH = '00000000-0000-4000-8000-0000000000b1';
const STATION = '00000000-0000-4000-8000-0000000000e1';

function buildConsumer() {
  const messaging = new CapturingMessagingClient();
  const branches = new InMemoryBranchRefRepository();
  const stations = new InMemoryStationRefRepository();
  const teams = new InMemoryTeamRefRepository();
  const consumer = new StructureEventsConsumer(
    messaging as unknown as MessagingClient,
    new ApplyBranchEventUseCase(branches),
    new ApplyStationEventUseCase(stations),
    new ApplyTeamEventUseCase(teams),
    new ApplyTeamScopeEventUseCase(teams),
  );
  return { messaging, branches, stations, teams, consumer };
}

describe('StructureEventsConsumer', () => {
  it('subscribes its own durable queue to every structure contract, serialized', async () => {
    const { messaging, consumer } = buildConsumer();

    await consumer.start();

    expect(messaging.subscription?.queue).toBe(STRUCTURE_EVENTS_QUEUE);
    expect(messaging.subscription?.prefetch).toBe(1);
    expect(
      messaging.subscription?.contracts.map((contract) => contract.type),
    ).toEqual([
      branchCreatedV1.type,
      branchUpdatedV1.type,
      stationCreatedV1.type,
      stationUpdatedV1.type,
      // Sprint 9.12: support teams. Routing keys on them, not on
      // departments — which still publish nothing (ADR 0022).
      supportTeamCreatedV1.type,
      supportTeamUpdatedV1.type,
      supportTeamScopeChangedV1.type,
    ]);
  });

  it('projects a branch and its station, and an archive arrives as an update', async () => {
    const { messaging, branches, stations, consumer } = buildConsumer();
    await consumer.start();

    await messaging.subscription?.handler({
      id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
      type: 'branch.created.v1',
      occurredAt: '2026-07-31T12:00:00.100Z',
      organizationId: ORG,
      payload: {
        branchId: BRANCH,
        organizationId: ORG,
        code: 'S12',
        name: 'Store 12',
        status: 'active',
        createdAt: '2026-07-31T12:00:00.000Z',
      },
    });
    await messaging.subscription?.handler({
      id: '8d2f1c8f-5e3a-4c8f-9b4f-0b2c3d4e5f6a',
      type: 'station.created.v1',
      occurredAt: '2026-07-31T12:01:00.100Z',
      organizationId: ORG,
      payload: {
        stationId: STATION,
        branchId: BRANCH,
        organizationId: ORG,
        code: 'C2',
        name: 'Cashier station 2',
        status: 'active',
        createdAt: '2026-07-31T12:01:00.000Z',
      },
    });

    expect(await branches.findActive(ORG, BRANCH)).not.toBeNull();
    expect(await stations.findActive(ORG, BRANCH, STATION)).not.toBeNull();

    await messaging.subscription?.handler({
      id: '9f4b2e0a-7a5c-4e0a-8d6a-2d4e5f6a7b8c',
      type: 'branch.updated.v1',
      occurredAt: '2026-07-31T13:00:00.100Z',
      organizationId: ORG,
      payload: {
        branchId: BRANCH,
        organizationId: ORG,
        code: 'S12',
        name: 'Store 12',
        status: 'archived',
        updatedAt: '2026-07-31T13:00:00.000Z',
      },
    });

    expect(await branches.findActive(ORG, BRANCH)).toBeNull();
  });

  it('ignores a stale replay: the LWW key is the payload timestamp', async () => {
    const { messaging, branches, consumer } = buildConsumer();
    await consumer.start();

    await messaging.subscription?.handler({
      id: '0a5c3f1b-8b6d-4f1b-9e7b-3e5f6a7b8c9d',
      type: 'branch.updated.v1',
      occurredAt: '2026-07-31T13:00:00.100Z',
      organizationId: ORG,
      payload: {
        branchId: BRANCH,
        organizationId: ORG,
        code: 'S12',
        name: 'Store 12',
        status: 'archived',
        updatedAt: '2026-07-31T13:00:00.000Z',
      },
    });
    // A replayed created event from before the archive must not resurrect it.
    await messaging.subscription?.handler({
      id: '1b6d4a2c-9c7e-4a2c-8f8c-4f6a7b8c9d0e',
      type: 'branch.created.v1',
      occurredAt: '2026-07-31T13:05:00.100Z',
      organizationId: ORG,
      payload: {
        branchId: BRANCH,
        organizationId: ORG,
        code: 'S12',
        name: 'Store 12',
        status: 'active',
        createdAt: '2026-07-31T12:00:00.000Z',
      },
    });

    expect(await branches.findActive(ORG, BRANCH)).toBeNull();
  });

  it('rejects a tenantless envelope so it dead-letters instead of projecting', async () => {
    const { messaging, branches, consumer } = buildConsumer();
    await consumer.start();

    await expect(
      messaging.subscription?.handler({
        id: '9e3a2d9f-6f4b-4d9f-8c5f-1c3d4e5f6a7b',
        type: 'branch.created.v1',
        occurredAt: '2026-07-31T12:00:00.100Z',
        // organizationId deliberately absent from the envelope.
        payload: {
          branchId: BRANCH,
          organizationId: ORG,
          code: 'S12',
          name: 'Store 12',
          status: 'active',
          createdAt: '2026-07-31T12:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);

    expect(branches.rows.size).toBe(0);
  });

  it('closes its messaging client on shutdown', async () => {
    const { messaging, consumer } = buildConsumer();

    await consumer.onApplicationShutdown();
    expect(messaging.closed).toBe(true);
  });
});
