/**
 * The sprint's key integration for notifications: the real consumer wired
 * to the real broker and database runs the full v2 chain — created seeds an
 * org-stamped ref, status-changed and staff comments notify the requester,
 * internal notes never do, assignment notifies the assignee, a redelivered
 * envelope collapses into the notification it already produced, v1 twins
 * are acked without notifying, and a v2 event whose organization
 * contradicts the stored ref dead-letters and creates nothing.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/notification-service:test-integration`.
 *
 * The queue is the service's real durable queue on the shared local
 * broker: stray messages from other local activity may add unrelated rows,
 * which each run wipes; assertions target this run's random identifiers.
 */
import { randomUUID } from 'node:crypto';
import {
  MessagingClient,
  ticketCommentAddedV2,
  ticketCreatedV1,
  ticketCreatedV2,
  ticketStatusChangedV1,
  ticketStatusChangedV2,
  ticketAssignedV2,
} from '@helpdesk-ai/messaging';
import { SystemClock } from '../../application/ports/notification.repository';
import {
  NotifyAssignedUseCase,
  NotifyCommentAddedUseCase,
  NotifyStatusChangedUseCase,
  RegisterTicketRefUseCase,
} from '../../application/use-cases/project-ticket-events';
import {
  PrismaNotificationRepository,
  PrismaTicketRefRepository,
} from '../../infrastructure/prisma/prisma-notification.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TicketEventsConsumer } from './ticket-events.consumer';

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!databaseUrl || !rabbitmqUrl) {
  throw new Error(
    'DATABASE_URL and RABBITMQ_URL must be set. Run via `nx run @helpdesk-ai/notification-service:test-integration` with the compose stack up.',
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

describe('notification flow (real broker, real database)', () => {
  let prisma: PrismaService;
  let consumerClient: MessagingClient;
  let publisherClient: MessagingClient;

  const organizationId = randomUUID();
  const foreignOrganizationId = randomUUID();
  const requesterId = randomUUID();
  const agentId = randomUUID();
  const ticketId = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    await prisma.notification.deleteMany();
    await prisma.ticketRef.deleteMany();

    consumerClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'notification-int-consumer',
    });
    publisherClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'notification-int-publisher',
    });

    const refs = new PrismaTicketRefRepository(prisma);
    const notifications = new PrismaNotificationRepository(prisma);
    const clock = new SystemClock();
    const deps = { refs, notifications, clock };
    const consumer = new TicketEventsConsumer(
      consumerClient,
      new RegisterTicketRefUseCase(refs),
      new NotifyStatusChangedUseCase(deps),
      new NotifyAssignedUseCase(deps),
      new NotifyCommentAddedUseCase(deps),
    );
    await consumer.start();
  });

  afterAll(async () => {
    await publisherClient.close();
    await consumerClient.close();
    await prisma.notification.deleteMany();
    await prisma.ticketRef.deleteMany();
    await prisma.$disconnect();
  });

  it('projects the full v2 lifecycle into org-stamped notifications, acking v1 twins and deduping redelivery', async () => {
    // Both versions of the created fact, the way the platform dual-publishes
    // during the compatibility window. Only the v2 twin may seed the ref.
    await publisherClient.publish(ticketCreatedV1, {
      ticketId,
      requesterId,
      title: 'Notification int test',
      priority: 'medium',
      status: 'open',
      createdAt: '2026-07-28T12:00:00.000Z',
    });
    await publisherClient.publish(
      ticketCreatedV2,
      {
        ticketId,
        requesterId,
        title: 'Notification int test',
        priority: 'medium',
        status: 'open',
        createdAt: '2026-07-28T12:00:00.000Z',
      },
      { organizationId },
    );

    // The created event seeds the ref (serialized by prefetch=1, so the
    // events below can only be handled after it) — carrying the tenant.
    const ref = await waitFor(() =>
      prisma.ticketRef.findUnique({ where: { ticketId } }),
    );
    expect(ref.organizationId).toBe(organizationId);

    await publisherClient.publish(ticketStatusChangedV1, {
      ticketId,
      actorId: agentId,
      fromStatus: 'open',
      toStatus: 'in_progress',
      changedAt: '2026-07-28T12:01:00.000Z',
    });
    await publisherClient.publish(
      ticketStatusChangedV2,
      {
        ticketId,
        actorId: agentId,
        fromStatus: 'open',
        toStatus: 'in_progress',
        changedAt: '2026-07-28T12:01:00.000Z',
      },
      { organizationId },
    );
    await publisherClient.publish(
      ticketCommentAddedV2,
      {
        ticketId,
        commentId: randomUUID(),
        authorId: agentId,
        internal: true,
        addedAt: '2026-07-28T12:02:00.000Z',
      },
      { organizationId },
    );
    await publisherClient.publish(
      ticketCommentAddedV2,
      {
        ticketId,
        commentId: randomUUID(),
        authorId: agentId,
        internal: false,
        addedAt: '2026-07-28T12:03:00.000Z',
      },
      { organizationId },
    );
    await publisherClient.publish(
      ticketAssignedV2,
      {
        ticketId,
        actorId: requesterId,
        assigneeId: agentId,
        assignedAt: '2026-07-28T12:04:00.000Z',
      },
      { organizationId },
    );

    // Assignee: exactly one assignment notification. Published last, so on
    // a prefetch=1 queue its arrival is the fence proving everything above
    // — including the v1 twins — has been fully handled.
    const agentRows = await waitFor(async () => {
      const rows = await prisma.notification.findMany({
        where: { userId: agentId },
      });
      return rows.length > 0 ? rows : null;
    });
    expect(agentRows).toHaveLength(1);
    expect(agentRows[0].type).toBe('ticket-assigned');
    expect(agentRows[0].organizationId).toBe(organizationId);

    // Requester: status change + public comment, each stamped with the
    // event's tenant. Exactly two — the v1 status-change twin was acked
    // without notifying, and the internal note never surfaces.
    const requesterRows = await prisma.notification.findMany({
      where: { userId: requesterId },
      orderBy: { createdAt: 'asc' },
    });
    expect(requesterRows.map((row) => row.type)).toEqual([
      'ticket-status-changed',
      'ticket-comment-added',
    ]);
    expect(
      requesterRows.every((row) => row.organizationId === organizationId),
    ).toBe(true);

    // Redelivery guarantee against the REAL unique index: adding the same
    // (userId, sourceEventId) pair twice collapses into one row.
    const repository = new PrismaNotificationRepository(prisma);
    const duplicate = {
      id: randomUUID(),
      userId: requesterId,
      organizationId,
      type: 'ticket-status-changed' as const,
      ticketId,
      message: 'redelivered',
      sourceEventId: requesterRows[0].sourceEventId,
      readAt: null,
      createdAt: new Date(),
    };
    await repository.add(duplicate);

    const statusRows = await prisma.notification.findMany({
      where: { userId: requesterId, type: 'ticket-status-changed' },
    });
    expect(statusRows).toHaveLength(1);
    expect(statusRows[0].id).toBe(requesterRows[0].id);
  });

  it('dead-letters a v2 status-change whose organization contradicts the stored ref, creating nothing', async () => {
    const mismatched = await publisherClient.publish(
      ticketStatusChangedV2,
      {
        ticketId,
        actorId: agentId,
        fromStatus: 'in_progress',
        toStatus: 'resolved',
        changedAt: '2026-07-28T12:05:00.000Z',
      },
      { organizationId: foreignOrganizationId },
    );
    // A well-tenanted sentinel published after it: prefetch=1 serializes, so
    // once the sentinel's notification lands, the mismatched delivery has
    // already been handled — and its handler threw, which is exactly what
    // nacks it to notification-service.ticket-events.dlq (the throw→DLQ
    // mechanics are the messaging client's own integration-tested
    // guarantee). A positive event as the fence beats sleeping on a timeout.
    const sentinel = await publisherClient.publish(
      ticketStatusChangedV2,
      {
        ticketId,
        actorId: agentId,
        fromStatus: 'in_progress',
        toStatus: 'resolved',
        changedAt: '2026-07-28T12:06:00.000Z',
      },
      { organizationId },
    );

    await waitFor(() =>
      prisma.notification.findFirst({
        where: { sourceEventId: sentinel.id },
      }),
    );

    // The forged event notified nobody and corrupted nothing: no row under
    // its envelope id, and the ref still names the real tenant.
    expect(
      await prisma.notification.findFirst({
        where: { sourceEventId: mismatched.id },
      }),
    ).toBeNull();
    const ref = await prisma.ticketRef.findUnique({ where: { ticketId } });
    expect(ref?.organizationId).toBe(organizationId);
  });
});
