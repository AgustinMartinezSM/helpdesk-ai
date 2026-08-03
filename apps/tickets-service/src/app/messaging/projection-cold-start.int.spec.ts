/**
 * The cold start, end to end, against a real broker and a real database
 * (Sprint 9.16).
 *
 * This is the failure `docs/architecture/pilot-readiness.md` names as item 1,
 * reproduced rather than described: a durable queue does not exist before its
 * consumer's first boot, and a topic exchange DISCARDS a message with no bound
 * queue. So the sequence below is the real one —
 *
 *   1. organizations-service publishes branch and team events;
 *   2. tickets-service has never run, so nothing is bound and the events go
 *      nowhere;
 *   3. tickets-service starts against an empty projection;
 *   4. reconciliation rebuilds it from the snapshot;
 *   5. a located ticket is accepted, and routing to a team works.
 *
 * Step 2 is the part that cannot be mocked: it is the broker's behaviour, and
 * asserting that the projection is still empty after publishing is what proves
 * the events were genuinely lost rather than merely slow.
 *
 * The snapshot source is a stub here, not organizations-service over HTTP —
 * running a second service inside this suite would test Nest's wiring rather
 * than the reconciliation, and the HTTP adapter has its own spec. What this
 * proves is everything downstream of "the snapshot answered".
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/tickets-service:test-integration`.
 */
import { randomUUID } from 'node:crypto';
import {
  MessagingClient,
  branchCreatedV1,
  deadLetterQueueOf,
  supportTeamCreatedV1,
  supportTeamScopeChangedV1,
} from '@helpdesk-ai/messaging';
import { connect as amqplibConnect } from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  ApplyBranchEventUseCase,
  ApplyStationEventUseCase,
  ApplyTeamEventUseCase,
  ApplyTeamScopeEventUseCase,
} from '../../application/use-cases/apply-structure-events';
import { CreateTicketUseCase } from '../../application/use-cases/create-ticket';
import { ReconcileStructureUseCase } from '../../application/use-cases/reconcile-structure';
import { RouteTicketUseCase } from '../../application/use-cases/route-ticket';
import type {
  BranchSnapshot,
  SnapshotPage,
  StationSnapshot,
  StructureSnapshotSource,
  TeamSnapshot,
} from '../../application/ports/structure-snapshot.source';
import { SystemClock } from '../../application/ports/ticket.repository';
import { FakeEventPublisher } from '../../application/testing/fakes';
import {
  PrismaBranchRefRepository,
  PrismaStationRefRepository,
  PrismaTeamRefRepository,
} from '../../infrastructure/prisma/prisma-structure-refs.repository';
import { PrismaTicketRepository } from '../../infrastructure/prisma/prisma-ticket.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  STRUCTURE_EVENTS_QUEUE,
  StructureEventsConsumer,
} from './structure-events.consumer';

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!databaseUrl || !rabbitmqUrl) {
  throw new Error(
    'DATABASE_URL and RABBITMQ_URL must be set. Run via `nx run @helpdesk-ai/tickets-service:test-integration` with the compose stack up.',
  );
}

const ORG_A = '00000000-0000-4000-8000-00000000a001';
const ORG_B = '00000000-0000-4000-8000-00000000b001';
const AT = new Date('2026-08-03T12:00:00.000Z');

/** Answers one page per resource; enough to prove the walk, not the paging. */
class StubSnapshotSource implements StructureSnapshotSource {
  branchRows: BranchSnapshot[] = [];
  stationRows: StationSnapshot[] = [];
  teamRows: TeamSnapshot[] = [];

  async branches(): Promise<SnapshotPage<BranchSnapshot>> {
    return { items: this.branchRows, nextCursor: null };
  }
  async stations(): Promise<SnapshotPage<StationSnapshot>> {
    return { items: this.stationRows, nextCursor: null };
  }
  async teams(): Promise<SnapshotPage<TeamSnapshot>> {
    return { items: this.teamRows, nextCursor: null };
  }
}

function staffActor(organizationId: string, teamIds: string[] = []): Actor {
  return {
    id: randomUUID(),
    organizationId,
    permissions: new Set([
      PERMISSIONS.TICKETS_CREATE,
      PERMISSIONS.TICKETS_READ_OWN,
      PERMISSIONS.ROUTING_MANAGE,
    ]),
    teamIds: teamIds.length > 0 ? new Set(teamIds) : undefined,
  };
}

describe('projection cold start (real RabbitMQ and PostgreSQL)', () => {
  const prisma = new PrismaService(databaseUrl as string);
  const branches = new PrismaBranchRefRepository(prisma);
  const stations = new PrismaStationRefRepository(prisma);
  const teams = new PrismaTeamRefRepository(prisma);
  const snapshot = new StubSnapshotSource();

  let publisher: MessagingClient;
  /** Every consumer started here, so every one of them is closed. */
  const started: StructureEventsConsumer[] = [];
  let admin: ChannelModel;
  let adminChannel: Channel;

  const branchId = randomUUID();
  const rivalBranchId = randomUUID();
  const centralTeamId = randomUUID();
  const localTeamId = randomUUID();

  beforeAll(async () => {
    admin = await amqplibConnect(rabbitmqUrl as string);
    adminChannel = await admin.createChannel();
    // A previous run leaves the durable queue behind, which would make the
    // "no queue exists" step a lie. Deleting it is what makes this a genuine
    // cold start every time.
    await adminChannel
      .deleteQueue(STRUCTURE_EVENTS_QUEUE)
      .catch(() => undefined);
    await adminChannel
      .deleteQueue(deadLetterQueueOf(STRUCTURE_EVENTS_QUEUE))
      .catch(() => undefined);

    publisher = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'tickets-service-coldstart-spec',
    });
  });

  beforeEach(async () => {
    await prisma.ticket.deleteMany();
    await prisma.teamBranchRef.deleteMany();
    await prisma.teamRef.deleteMany();
    await prisma.stationRef.deleteMany();
    await prisma.branchRef.deleteMany();
  });

  afterAll(async () => {
    for (const instance of started) {
      await instance.onApplicationShutdown();
    }
    await publisher.close();
    await adminChannel.close();
    await admin.close();
    await prisma.ticket.deleteMany();
    await prisma.teamBranchRef.deleteMany();
    await prisma.teamRef.deleteMany();
    await prisma.stationRef.deleteMany();
    await prisma.branchRef.deleteMany();
    await prisma.$disconnect();
  });

  /**
   * Every consumer this suite starts is recorded so afterAll can close all of
   * them. Closing only the most recent one leaks an AMQP connection per test,
   * which jest then waits on forever at the end of the run — the suite passes
   * and the process never exits.
   */
  function buildConsumer(reconcile: ReconcileStructureUseCase | null) {
    const messaging = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'tickets-service-coldstart-spec',
    });
    const consumer = new StructureEventsConsumer(
      messaging,
      new ApplyBranchEventUseCase(branches),
      new ApplyStationEventUseCase(stations),
      new ApplyTeamEventUseCase(teams),
      new ApplyTeamScopeEventUseCase(teams),
      undefined,
      reconcile,
    );
    started.push(consumer);
    return { messaging, consumer };
  }

  async function publishStructure(): Promise<void> {
    await publisher.publish(
      branchCreatedV1,
      {
        branchId,
        organizationId: ORG_A,
        code: 'BR-12',
        name: 'Store 12',
        status: 'active',
        createdAt: AT.toISOString(),
      },
      { organizationId: ORG_A },
    );
    await publisher.publish(
      supportTeamCreatedV1,
      {
        teamId: centralTeamId,
        organizationId: ORG_A,
        key: 'it',
        name: 'IT support',
        status: 'active',
        createdAt: AT.toISOString(),
      },
      { organizationId: ORG_A },
    );
  }

  /** What organizations-service would answer for the rows published above. */
  function loadSnapshot(): void {
    snapshot.branchRows = [
      {
        branchId,
        organizationId: ORG_A,
        code: 'BR-12',
        name: 'Store 12',
        status: 'active',
        updatedAt: AT,
      },
      {
        // Another tenant's branch, in the same global snapshot page.
        branchId: rivalBranchId,
        organizationId: ORG_B,
        code: 'BR-12',
        name: 'Store 12',
        status: 'active',
        updatedAt: AT,
      },
    ];
    snapshot.teamRows = [
      {
        teamId: centralTeamId,
        organizationId: ORG_A,
        name: 'IT support',
        status: 'active',
        branchIds: [],
        updatedAt: AT,
      },
      {
        teamId: localTeamId,
        organizationId: ORG_A,
        name: 'Store 12 desk',
        status: 'active',
        branchIds: [branchId],
        updatedAt: AT,
      },
    ];
    snapshot.stationRows = [];
  }

  it('loses events published before any queue exists, then rebuilds and works', async () => {
    // 1 + 2. The source has structure and publishes it. Nothing is bound.
    await publishStructure();
    // Give the broker a moment to route (and discard) the two messages.
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 3. A cold service: the projection is empty, and the events are GONE —
    // not queued, not delayed. This assertion is the whole finding.
    expect(await prisma.branchRef.count()).toBe(0);
    expect(await prisma.teamRef.count()).toBe(0);

    // A located ticket is refused at this point, which is the product
    // consequence: fail-closed validation against an empty projection.
    const tickets = new PrismaTicketRepository(prisma);
    const create = new CreateTicketUseCase(
      tickets,
      new SystemClock(),
      new FakeEventPublisher(),
      branches,
      stations,
    );
    const actor = staffActor(ORG_A);
    await expect(
      create.execute(actor, {
        title: 'Card terminal down',
        description: 'Cashier 2 cannot take payments.',
        branchId,
      }),
    ).rejects.toThrow();

    // 4. Start the consumer WITH reconciliation. Subscribe happens first and
    // the snapshot second — the ordering the use case documents.
    loadSnapshot();
    const reconcile = new ReconcileStructureUseCase(
      snapshot,
      branches,
      stations,
      teams,
    );
    const { consumer } = buildConsumer(reconcile);
    await consumer.start();
    const result = await reconcile.execute();

    expect(result.complete).toBe(true);
    expect(result.branches.inserted).toBe(2);
    expect(result.teams.inserted).toBe(2);

    // 5. The same located ticket is now accepted.
    const created = await create.execute(actor, {
      title: 'Card terminal down',
      description: 'Cashier 2 cannot take payments.',
      branchId,
    });
    expect(created.branchId).toBe(branchId);

    // 6. An organization-wide team can take it (no scope rows = everywhere).
    const route = new RouteTicketUseCase(tickets, teams, new SystemClock());
    const routed = await route.execute(staffActor(ORG_A, [centralTeamId]), {
      ticketId: created.id,
      teamId: centralTeamId,
    });
    expect(routed.assignedTeamId).toBe(centralTeamId);

    // 7. And a branch-scoped team kept its exact scope: it covers this
    // branch, so it takes this ticket.
    const rerouted = await route.execute(staffActor(ORG_A, [localTeamId]), {
      ticketId: created.id,
      teamId: localTeamId,
    });
    expect(rerouted.assignedTeamId).toBe(localTeamId);

    // 10. Organization B's branch went into B's projection, never A's — from
    // a single GLOBAL snapshot page that held both.
    expect(await branches.findActive(ORG_A, rivalBranchId)).toBeNull();
    expect(await branches.findActive(ORG_B, rivalBranchId)).not.toBeNull();
  });

  it('keeps consuming incremental events after the rebuild (scenario 14)', async () => {
    loadSnapshot();
    const reconcile = new ReconcileStructureUseCase(
      snapshot,
      branches,
      stations,
      teams,
    );
    const { consumer } = buildConsumer(reconcile);
    await consumer.start();
    await reconcile.execute();

    // An event published AFTER the rebuild, carrying a newer timestamp.
    const later = new Date(AT.getTime() + 60_000);
    await publisher.publish(
      supportTeamScopeChangedV1,
      {
        teamId: centralTeamId,
        organizationId: ORG_A,
        branchIds: [branchId],
        changedAt: later.toISOString(),
      },
      { organizationId: ORG_A },
    );

    await waitFor(async () => {
      const team = await teams.findActive(ORG_A, centralTeamId);
      return team?.branchIds.length === 1;
    });

    // Normal event-driven operation continues: the team that was
    // organization-wide in the snapshot is now scoped to one branch.
    const team = await teams.findActive(ORG_A, centralTeamId);
    expect(team?.branchIds).toEqual([branchId]);
  });

  it('does not let the snapshot undo an update that arrived first (scenario 12)', async () => {
    // The race requirement 11 is about, arranged deliberately: the consumer
    // is live and an event lands BEFORE the reconciliation writes its page.
    const reconcile = new ReconcileStructureUseCase(
      snapshot,
      branches,
      stations,
      teams,
    );
    const { consumer } = buildConsumer(reconcile);
    await consumer.start();

    const later = new Date(AT.getTime() + 60_000);
    await publisher.publish(
      branchCreatedV1,
      {
        branchId,
        organizationId: ORG_A,
        code: 'BR-12',
        name: 'Renamed by event',
        status: 'active',
        createdAt: later.toISOString(),
      },
      { organizationId: ORG_A },
    );
    await waitFor(async () => (await prisma.branchRef.count()) > 0);

    // The snapshot still carries the OLDER state, as a real one read before
    // that event would.
    loadSnapshot();
    await reconcile.execute();

    const branch = await branches.findActive(ORG_A, branchId);
    // Last-write-wins on the source timestamp is what makes subscribe-then-
    // snapshot safe: the older snapshot row cannot overwrite the newer event.
    expect(branch?.name).toBe('Renamed by event');
  });

  it('reports drift without changing anything in dry-run mode (scenario 13)', async () => {
    loadSnapshot();
    const reconcile = new ReconcileStructureUseCase(
      snapshot,
      branches,
      stations,
      teams,
    );

    const check = await reconcile.execute({ dryRun: true });

    expect(check.dryRun).toBe(true);
    expect(check.branches.inserted).toBe(2);
    // Nothing written: the integrity check is safe to run against a live
    // service at any time.
    expect(await prisma.branchRef.count()).toBe(0);
    expect(await prisma.teamRef.count()).toBe(0);
  });
});

/** Polls a condition; the broker is asynchronous and jest is not. */
async function waitFor(
  condition: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('timed out waiting for the projection to catch up');
}
