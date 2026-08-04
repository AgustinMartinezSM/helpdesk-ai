/**
 * The sprint's key integration for analytics: real broker + real database,
 * exercising the ATOMIC last-writer-wins upsert in actual SQL — the piece
 * the in-memory fake can only imitate. Covers the v2 lifecycle chain under
 * two organizations, one person counted in two organizations, the phase-8
 * unbinding of the retired v1 routing keys, the out-of-order backfill and
 * stale-event rejection.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/analytics-service:test-integration`.
 */
import { randomUUID } from 'node:crypto';
import { connect as amqplibConnect } from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import {
  MessagingClient,
  deadLetterQueueOf,
  defineEvent,
  membershipCreatedV1,
  ticketCreatedV2,
  ticketStatusChangedV2,
  userRegisteredV1,
} from '@helpdesk-ai/messaging';
import {
  ApplyMembershipCreatedUseCase,
  ApplyTicketCreatedUseCase,
  ApplyTicketStatusChangedUseCase,
} from '../../application/use-cases/apply-events';
import {
  PrismaTicketSnapshotRepository,
  PrismaUserSnapshotRepository,
} from '../../infrastructure/prisma/prisma-analytics.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { METRICS_QUEUE, MetricsConsumer } from './metrics.consumer';

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!databaseUrl || !rabbitmqUrl) {
  throw new Error(
    'DATABASE_URL and RABBITMQ_URL must be set. Run via `nx run @helpdesk-ai/analytics-service:test-integration` with the compose stack up.',
  );
}

const DLQ = deadLetterQueueOf(METRICS_QUEUE);

// A contract that exists ONLY in this spec: phase 8 deleted the platform's
// v1 definitions, so publishing this impersonates the one thing that could
// still emit the type — a legacy producer. Same schema as v2 on purpose:
// the two revisions carried byte-identical payloads.
const legacyTicketCreatedV1 = defineEvent(
  'ticket.created.v1',
  ticketCreatedV2.payloadSchema,
);

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
  let rawConnection: ChannelModel;
  let rawChannel: Channel;

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
      new ApplyMembershipCreatedUseCase(userSnapshots),
    );
    await consumer.start();

    // Raw side channel to inspect the DLQ. Purged up front: on the shared
    // local broker the dead letters of earlier runs are noise.
    rawConnection = await amqplibConnect(rabbitmqUrl as string);
    rawChannel = await rawConnection.createChannel();
    await rawChannel.purgeQueue(DLQ);
  });

  afterAll(async () => {
    // The queue and its DLQ stay: they are the service's real durable
    // topology on the local broker, not fixtures of this suite.
    await rawConnection.close();
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
    // membership.created.v1 is the ONLY writer of user_snapshots since
    // Sprint 10.7, so this is simply how a row comes to exist.
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

    // user_snapshots is written ONLY by membership.created.v1 now, one row
    // per edge, looked up by the composite key.
    const userRowA = await waitFor(async () => {
      const row = await prisma.userSnapshot.findUnique({
        where: {
          userId_organizationId: { userId: userA, organizationId: orgA },
        },
      });
      return row ?? null;
    });
    expect(userRowA.joinedAt).toEqual(new Date('2026-07-28T12:00:01.000Z'));

    const userRowB = await waitFor(async () => {
      const row = await prisma.userSnapshot.findUnique({
        where: {
          userId_organizationId: { userId: userB, organizationId: orgB },
        },
      });
      return row ?? null;
    });
    expect(userRowB.joinedAt).toEqual(new Date('2026-07-25T12:00:01.000Z'));

    // The registration published above wrote NOTHING, and dead-lettered
    // nothing either — its binding is retired, so it never reaches this
    // queue. Asserting the absence is what would catch a re-added arm, which
    // the NOT NULL column would then refuse.
    expect(await prisma.userSnapshot.count({ where: { userId: userA } })).toBe(
      1,
    );

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

  it('counts one person in BOTH organizations, against the real composite key', async () => {
    /**
     * The defect Sprint 10.7 closed, proved where only a database can prove
     * it (ADR 0026).
     *
     * This was written RED alongside its unit twin, and the two failed in
     * OPPOSITE directions: the in-memory double overwrote the tenant, so the
     * first organization dropped to zero there, while Prisma refused the
     * second membership outright — `updateMany ... WHERE organization_id IS
     * NULL` matched nothing and the follow-up insert hit the old primary key
     * — so the second organization stayed at zero here. That asymmetry was
     * the divergence, and it is why neither test alone was enough.
     *
     * It also pins the real-world shape of the bug rather than an abstract
     * one: the FIRST membership is the bootstrap organization, exactly as
     * registration produces it, and it used to win forever.
     */
    const person = randomUUID();
    const bootstrapish = randomUUID();
    const real = randomUUID();

    for (const [organizationId, createdAt] of [
      [bootstrapish, '2026-07-28T12:00:00.000Z'],
      [real, '2026-07-29T12:00:00.000Z'],
    ] as const) {
      await publisherClient.publish(
        membershipCreatedV1,
        {
          membershipId: randomUUID(),
          organizationId,
          userId: person,
          roleTemplate: 'member',
          status: 'active',
          createdAt,
        },
        { organizationId },
      );
    }

    await waitFor(async () => {
      const rows = await prisma.userSnapshot.count({
        where: { userId: person },
      });
      return rows === 2 ? rows : null;
    });

    // Both counts, not one — and asserted through the composite lookup as
    // well as the aggregate, because a surviving user_id uniqueness would
    // make the second insert a silent no-op that `total()` alone could not
    // distinguish from a correct one.
    expect(await userSnapshots.total(bootstrapish)).toBe(1);
    expect(await userSnapshots.total(real)).toBe(1);
    expect(
      await prisma.userSnapshot.findUnique({
        where: {
          userId_organizationId: { userId: person, organizationId: real },
        },
      }),
    ).toMatchObject({ joinedAt: new Date('2026-07-29T12:00:00.000Z') });

    // Redelivery stays a no-op on the composite key.
    await publisherClient.publish(
      membershipCreatedV1,
      {
        membershipId: randomUUID(),
        organizationId: real,
        userId: person,
        roleTemplate: 'member',
        status: 'active',
        createdAt: '2026-08-04T09:00:00.000Z',
      },
      { organizationId: real },
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(await userSnapshots.total(real)).toBe(1);
  });

  it('never receives a retired v1 event: the unbind kept it off the queue', async () => {
    const v1Ticket = randomUUID();
    const markerTicket = randomUUID();
    const org = randomUUID();

    const legacy = await publisherClient.publish(legacyTicketCreatedV1, {
      ticketId: v1Ticket,
      requesterId: randomUUID(),
      title: 'legacy v1 — must never be enqueued',
      priority: 'high',
      status: 'open',
      createdAt: '2026-07-28T12:00:00.000Z',
    });
    // The marker is published AFTER the legacy event on the same channel
    // and the consumer is serialized (prefetch 1), so once the marker is
    // projected, anything the broker enqueued before it has already been
    // through the handler — or the DLQ.
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

    // Nothing projected under the legacy ticket id...
    const v1Row = await prisma.ticketSnapshot.findUnique({
      where: { ticketId: v1Ticket },
    });
    expect(v1Row).toBeNull();

    // ...and not because the consumer politely acked it: this consumer has
    // no v1 contract any more, so had the durable queue's old v1 binding
    // survived, the delivery would have failed decode ("no contract bound")
    // and dead-lettered. Draining the DLQ and finding no envelope with the
    // legacy id proves the broker never enqueued it — the boot-time unbind
    // is the thing under test here. Strays from other local activity are
    // drained and dropped, same caveat as the table wipes.
    const deadLetteredIds: string[] = [];
    for (;;) {
      const message = await rawChannel.get(DLQ, { noAck: true });
      if (message === false) {
        break;
      }
      try {
        const body = JSON.parse(message.content.toString('utf-8')) as {
          id?: string;
        };
        if (body.id) {
          deadLetteredIds.push(body.id);
        }
      } catch {
        // Undecodable strays cannot be the envelope we published.
      }
    }
    expect(deadLetteredIds).not.toContain(legacy.id);
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
