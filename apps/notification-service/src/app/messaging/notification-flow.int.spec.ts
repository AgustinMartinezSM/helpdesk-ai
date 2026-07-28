/**
 * The sprint's key integration for notifications: the real consumer wired
 * to the real broker and database runs the full chain — created seeds the
 * ref, status-changed and staff comments notify the requester, internal
 * notes never do, assignment notifies the assignee, and a redelivered
 * envelope collapses into the notification it already produced.
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
  ticketCommentAddedV1,
  ticketCreatedV1,
  ticketStatusChangedV1,
  ticketAssignedV1,
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

  it('projects the full lifecycle into the right notifications, deduping redelivery', async () => {
    await publisherClient.publish(ticketCreatedV1, {
      ticketId,
      requesterId,
      title: 'Notification int test',
      priority: 'medium',
      status: 'open',
      createdAt: '2026-07-28T12:00:00.000Z',
    });

    // The created event seeds the ref (serialized by prefetch=1, so the
    // events below can only be handled after it).
    await waitFor(() => prisma.ticketRef.findUnique({ where: { ticketId } }));

    await publisherClient.publish(ticketStatusChangedV1, {
      ticketId,
      actorId: agentId,
      fromStatus: 'open',
      toStatus: 'in_progress',
      changedAt: '2026-07-28T12:01:00.000Z',
    });
    await publisherClient.publish(ticketCommentAddedV1, {
      ticketId,
      commentId: randomUUID(),
      authorId: agentId,
      internal: true,
      addedAt: '2026-07-28T12:02:00.000Z',
    });
    await publisherClient.publish(ticketCommentAddedV1, {
      ticketId,
      commentId: randomUUID(),
      authorId: agentId,
      internal: false,
      addedAt: '2026-07-28T12:03:00.000Z',
    });
    await publisherClient.publish(ticketAssignedV1, {
      ticketId,
      actorId: requesterId,
      assigneeId: agentId,
      assignedAt: '2026-07-28T12:04:00.000Z',
    });

    // Requester: status change + public comment. The internal note must
    // never surface.
    await waitFor(async () => {
      const rows = await prisma.notification.findMany({
        where: { userId: requesterId },
      });
      return rows.length === 2 ? rows : null;
    });
    const requesterRows = await prisma.notification.findMany({
      where: { userId: requesterId },
      orderBy: { createdAt: 'asc' },
    });
    expect(requesterRows.map((row) => row.type)).toEqual([
      'ticket-status-changed',
      'ticket-comment-added',
    ]);

    // Assignee: exactly one assignment notification.
    const agentRows = await waitFor(async () => {
      const rows = await prisma.notification.findMany({
        where: { userId: agentId },
      });
      return rows.length > 0 ? rows : null;
    });
    expect(agentRows).toHaveLength(1);
    expect(agentRows[0].type).toBe('ticket-assigned');

    // Redelivery guarantee against the REAL unique index: adding the same
    // (userId, sourceEventId) pair twice collapses into one row.
    const repository = new PrismaNotificationRepository(prisma);
    const duplicate = {
      id: randomUUID(),
      userId: requesterId,
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
});
