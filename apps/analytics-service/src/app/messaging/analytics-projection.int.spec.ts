/**
 * The sprint's key integration for analytics: real broker + real database,
 * exercising the ATOMIC last-writer-wins upsert in actual SQL — the piece
 * the in-memory fake can only imitate. Covers the lifecycle chain, the
 * out-of-order backfill, stale-event rejection and user registration.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/analytics-service:test-integration`.
 */
import { randomUUID } from 'node:crypto';
import {
  MessagingClient,
  ticketCreatedV1,
  ticketStatusChangedV1,
  userRegisteredV1,
} from '@helpdesk-ai/messaging';
import {
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
  let consumerClient: MessagingClient;
  let publisherClient: MessagingClient;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    snapshots = new PrismaTicketSnapshotRepository(prisma);
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
      new ApplyUserRegisteredUseCase(new PrismaUserSnapshotRepository(prisma)),
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

  it('projects the lifecycle end to end through the broker', async () => {
    const ticketId = randomUUID();
    const userId = randomUUID();

    await publisherClient.publish(ticketCreatedV1, {
      ticketId,
      requesterId: userId,
      title: 'Analytics int test',
      priority: 'high',
      status: 'open',
      createdAt: '2026-07-28T12:00:00.000Z',
    });
    await publisherClient.publish(ticketStatusChangedV1, {
      ticketId,
      actorId: userId,
      fromStatus: 'open',
      toStatus: 'resolved',
      changedAt: '2026-07-28T13:00:00.000Z',
    });
    await publisherClient.publish(userRegisteredV1, {
      userId,
      email: `${randomUUID()}@example.com`,
      roles: ['user'],
      registeredAt: '2026-07-28T12:00:00.000Z',
    });

    const snapshot = await waitFor(async () => {
      const row = await prisma.ticketSnapshot.findUnique({
        where: { ticketId },
      });
      return row && row.status === 'resolved' ? row : null;
    });
    expect(snapshot.priority).toBe('high');
    expect(snapshot.resolvedAt).toEqual(new Date('2026-07-28T13:00:00.000Z'));

    await waitFor(async () => {
      const row = await prisma.userSnapshot.findUnique({ where: { userId } });
      return row ?? null;
    });
  });

  it('enforces the LWW guard atomically in SQL: stale events cannot regress', async () => {
    const ticketId = randomUUID();

    await snapshots.applyCreated({
      ticketId,
      status: 'open',
      priority: 'low',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    await snapshots.applyStatusChanged({
      ticketId,
      toStatus: 'resolved',
      changedAt: new Date('2026-07-28T13:00:00.000Z'),
      occurredAt: new Date('2026-07-28T13:00:00.100Z'),
    });

    // Stale replay (older occurredAt) must be a no-op on status.
    await snapshots.applyStatusChanged({
      ticketId,
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

    await snapshots.applyStatusChanged({
      ticketId,
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-28T12:05:00.000Z'),
      occurredAt: new Date('2026-07-28T12:05:00.100Z'),
    });
    let row = await prisma.ticketSnapshot.findUnique({ where: { ticketId } });
    expect(row?.priority).toBeNull();

    await snapshots.applyCreated({
      ticketId,
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
