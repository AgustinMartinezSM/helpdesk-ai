/**
 * The sprint's key integration for analytics: real broker + real database,
 * exercising the ATOMIC last-writer-wins upsert in actual SQL — the piece
 * the in-memory fake can only imitate. Covers the v2 lifecycle chain under
 * two organizations, the membership stamp on user snapshots, the v1 no-op
 * path, the out-of-order backfill and stale-event rejection.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/analytics-service:test-integration`.
 */
import { randomUUID } from 'node:crypto';
import {
  MessagingClient,
  membershipCreatedV1,
  ticketCreatedV1,
  ticketCreatedV2,
  ticketStatusChangedV2,
  userRegisteredV1,
} from '@helpdesk-ai/messaging';
import {
  ApplyMembershipCreatedUseCase,
  ApplyTicketCreatedUseCase,
  ApplyTicketStatusChangedUseCase,
  ApplyUserRegisteredUseCase,
} from '../../application/use-cases/apply-events';
import {
  PrismaTicketSnapshotRepository,
  PrismaUserSnapshotRepository,
} from '../../infrastructure/prisma/prisma-analytics.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MetricsConsumer } from './metrics.consumer';

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!databaseUrl || !rabbitmqUrl) {
  throw new Error(
    'DATABASE_URL and RABBITMQ_URL must be set. Run via `nx run @helpdesk-ai/analytics-service:test-integration` with the compose stack up.',
  );
}

async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await probe();
    if (result !== null) {
      return result;
    }
    if (Date.now() > deadline) {
      throw new Error('condition not met within timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe('analytics projection (real broker, real database)', () => {
  let prisma: PrismaService;
  let snapshots: PrismaTicketSnapshotRepository;
  let userSnapshots: PrismaUserSnapshotRepository;
  let consumerClient: MessagingClient;
  let publisherClient: MessagingClient;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    snapshots = new PrismaTicketSnapshotRepository(prisma);
    userSnapshots = new PrismaUserSnapshotRepository(prisma);
    await prisma.ticketSnapshot.deleteMany();
    await prisma.userSnapshot.deleteMany();

    consumerClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'analytics-int-consumer',
    });
    publisherClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'analytics-int-publisher',
    });

    const consumer = new MetricsConsumer(
      consumerClient,
      new ApplyTicketCreatedUseCase(snapshots),
      new ApplyTicketStatusChangedUseCase(snapshots),
      new ApplyUserRegisteredUseCase(userSnapshots),
      new ApplyMembershipCreatedUseCase(userSnapshots),
    );
    await consumer.start();
  });

  afterAll(async () => {
    await publisherClient.close();
    await consumerClient.close();
    await prisma.ticketSnapshot.deleteMany();
    await prisma.userSnapshot.deleteMany();
    await prisma.$disconnect();
  });

  it('projects the v2 lifecycle end to end and keeps the two organizations apart', async () => {
    const orgA = randomUUID();
    const orgB = randomUUID();
    const ticketA = randomUUID();
    const ticketB = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();

    // Organization A: full lifecycle plus a registered member.
    await publisherClient.publish(
      ticketCreatedV2,
      {
        ticketId: ticketA,
        requesterId: userA,
        title: 'Analytics int test (org A)',
        priority: 'high',
        status: 'open',
        createdAt: '2026-07-28T12:00:00.000Z',
      },
      { organizationId: orgA },
    );
    await publisherClient.publish(
      ticketStatusChangedV2,
      {
        ticketId: ticketA,
        actorId: userA,
        fromStatus: 'open',
        toStatus: 'resolved',
        changedAt: '2026-07-28T13:00:00.000Z',
      },
      { organizationId: orgA },
    );
    await publisherClient.publish(userRegisteredV1, {
      userId: userA,
      email: `${randomUUID()}@example.com`,
      roles: ['user'],
      registeredAt: '2026-07-28T12:00:00.000Z',
    });
    await publisherClient.publish(
      membershipCreatedV1,
      {
        membershipId: randomUUID(),
        organizationId: orgA,
        userId: userA,
        roleTemplate: 'member',
        status: 'active',
        createdAt: '2026-07-28T12:00:01.000Z',
      },
      { organizationId: orgA },
    );

    // Organization B: distinct buckets on purpose (open/urgent/07-25), so a
    // leak into A's aggregates shows up as an alien key or day, not a count.
    await publisherClient.publish(
      ticketCreatedV2,
      {
        ticketId: ticketB,
        requesterId: userB,
        title: 'Analytics int test (org B)',
        priority: 'urgent',
        status: 'open',
        createdAt: '2026-07-25T12:00:00.000Z',
      },
      { organizationId: orgB },
    );
    // No registration for user B: membership.created alone must create the
    // row (lost-registration tolerance), exercised here against real SQL.
    await publisherClient.publish(
      membershipCreatedV1,
      {
        membershipId: randomUUID(),
        organizationId: orgB,
        userId: userB,
        roleTemplate: 'member',
        status: 'active',
        createdAt: '2026-07-25T12:00:01.000Z',
      },
      { organizationId: orgB },
    );

    const snapshotA = await waitFor(async () => {
      const row = await prisma.ticketSnapshot.findUnique({
        where: { ticketId: ticketA },
      });
      return row && row.status === 'resolved' ? row : null;
    });
    expect(snapshotA.priority).toBe('high');
    expect(snapshotA.resolvedAt).toEqual(new Date('2026-07-28T13:00:00.000Z'));
    expect(snapshotA.organizationId).toBe(orgA);

    await waitFor(async () => {
      const row = await prisma.ticketSnapshot.findUnique({
        where: { ticketId: ticketB },
      });
      return row ?? null;
    });

    // user_snapshots takes its organization from membership.created.v1: the
    // stamp on A's registered row, the whole row for B's lost registration.
    const userRowA = await waitFor(async () => {
      const row = await prisma.userSnapshot.findUnique({
        where: { userId: userA },
      });
      return row && row.organizationId === orgA ? row : null;
    });
    expect(userRowA.registeredAt).toEqual(new Date('2026-07-28T12:00:00.000Z'));

    const userRowB = await waitFor(async () => {
      const row = await prisma.userSnapshot.findUnique({
        where: { userId: userB },
      });
      return row ?? null;
    });
    expect(userRowB.organizationId).toBe(orgB);
    // registeredAt is the membership time: the honest nearby value.
    expect(userRowB.registeredAt).toEqual(new Date('2026-07-25T12:00:01.000Z'));

    // Each organization's summary sees only its own rows, across all five
    // aggregates, in the real WHERE clauses.
    const from = new Date('2026-07-20T00:00:00.000Z');
    expect(await snapshots.total(orgA)).toBe(1);
    expect(await snapshots.countByStatus(orgA)).toEqual({ resolved: 1 });
    expect(await snapshots.countByPriority(orgA)).toEqual({ high: 1 });
    expect(await snapshots.createdPerDaySince(orgA, from)).toEqual([
      { day: '2026-07-28', count: 1 },
    ]);
    expect(await userSnapshots.total(orgA)).toBe(1);

    expect(await snapshots.total(orgB)).toBe(1);
    expect(await snapshots.countByStatus(orgB)).toEqual({ open: 1 });
    expect(await snapshots.countByPriority(orgB)).toEqual({ urgent: 1 });
    expect(await snapshots.createdPerDaySince(orgB, from)).toEqual([
      { day: '2026-07-25', count: 1 },
    ]);
    expect(await userSnapshots.total(orgB)).toBe(1);
  });

  it('acknowledges v1 ticket events without projecting anything', async () => {
    const v1Ticket = randomUUID();
    const markerTicket = randomUUID();
    const org = randomUUID();

    await publisherClient.publish(ticketCreatedV1, {
      ticketId: v1Ticket,
      requesterId: randomUUID(),
      title: 'v1 twin — must be a no-op',
      priority: 'high',
      status: 'open',
      createdAt: '2026-07-28T12:00:00.000Z',
    });
    // The marker is published AFTER the v1 event on the same channel and the
    // consumer is serialized (prefetch 1), so once the marker is projected
    // the v1 delivery has already been handled — and handled as a no-op.
    await publisherClient.publish(
      ticketCreatedV2,
      {
        ticketId: markerTicket,
        requesterId: randomUUID(),
        title: 'marker',
        priority: 'low',
        status: 'open',
        createdAt: '2026-07-28T12:00:00.000Z',
      },
      { organizationId: org },
    );

    await waitFor(async () => {
      const row = await prisma.ticketSnapshot.findUnique({
        where: { ticketId: markerTicket },
      });
      return row ?? null;
    });

    const v1Row = await prisma.ticketSnapshot.findUnique({
      where: { ticketId: v1Ticket },
    });
    expect(v1Row).toBeNull();
  });

  it('enforces the LWW guard atomically in SQL: stale events cannot regress', async () => {
    const ticketId = randomUUID();
    const org = randomUUID();

    await snapshots.applyCreated({
      ticketId,
      organizationId: org,
      status: 'open',
      priority: 'low',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    await snapshots.applyStatusChanged({
      ticketId,
      organizationId: org,
      toStatus: 'resolved',
      changedAt: new Date('2026-07-28T13:00:00.000Z'),
      occurredAt: new Date('2026-07-28T13:00:00.100Z'),
    });

    // Stale replay (older occurredAt) must be a no-op on status.
    await snapshots.applyStatusChanged({
      ticketId,
      organizationId: org,
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-28T12:30:00.000Z'),
      occurredAt: new Date('2026-07-28T12:30:00.100Z'),
    });

    let row = await prisma.ticketSnapshot.findUnique({ where: { ticketId } });
    expect(row?.status).toBe('resolved');
    expect(row?.lastEventAt).toEqual(new Date('2026-07-28T13:00:00.100Z'));

    // Out-of-order created (a very late redelivery) backfills nothing here
    // but must not regress status either.
    await snapshots.applyCreated({
      ticketId,
      organizationId: org,
      status: 'open',
      priority: 'low',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    row = await prisma.ticketSnapshot.findUnique({ where: { ticketId } });
    expect(row?.status).toBe('resolved');
    expect(row?.resolvedAt).not.toBeNull();
  });

  it('backfills a snapshot seeded by an early status change when created arrives', async () => {
    const ticketId = randomUUID();
    const org = randomUUID();

    await snapshots.applyStatusChanged({
      ticketId,
      organizationId: org,
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-28T12:05:00.000Z'),
      occurredAt: new Date('2026-07-28T12:05:00.100Z'),
    });
    let row = await prisma.ticketSnapshot.findUnique({ where: { ticketId } });
    expect(row?.priority).toBeNull();

    await snapshots.applyCreated({
      ticketId,
      organizationId: org,
      status: 'open',
      priority: 'urgent',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    row = await prisma.ticketSnapshot.findUnique({ where: { ticketId } });
    expect(row?.status).toBe('in_progress');
    expect(row?.priority).toBe('urgent');
    expect(row?.createdAt).toEqual(new Date('2026-07-28T12:00:00.000Z'));
  });
});
