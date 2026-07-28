/**
 * The sprint's key integration for audit: events published to the real
 * broker — one with a platform contract, one the consumer has never heard
 * of — both land as rows in the real database through the actual firehose
 * consumer, and recording the same envelope twice collapses into one row.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/audit-service:test-integration`.
 *
 * The queue is the service's real durable queue on the shared local
 * broker: stray messages from other local activity just record extra rows
 * in the test database, which each run wipes; assertions target only this
 * run's random identifiers.
 */
import { randomUUID } from 'node:crypto';
import { z } from '@helpdesk-ai/configuration';
import {
  MessagingClient,
  defineEvent,
  ticketCreatedV1,
} from '@helpdesk-ai/messaging';
import { SystemClock } from '../../application/ports/audit-event.repository';
import { RecordAuditEventUseCase } from '../../application/use-cases/record-audit-event';
import { PrismaAuditEventRepository } from '../../infrastructure/prisma/prisma-audit-event.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EventLogConsumer } from './event-log.consumer';

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!databaseUrl || !rabbitmqUrl) {
  throw new Error(
    'DATABASE_URL and RABBITMQ_URL must be set. Run via `nx run @helpdesk-ai/audit-service:test-integration` with the compose stack up.',
  );
}

// A contract that exists ONLY in this spec: to the consumer under test the
// resulting event is an unknown type — exactly what the firehose is for.
const wormholeOpenedV9 = defineEvent(
  'wormhole.opened.v9',
  z.object({ sector: z.number() }),
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

describe('audit trail (real broker, real database)', () => {
  let prisma: PrismaService;
  let repository: PrismaAuditEventRepository;
  let consumerClient: MessagingClient;
  let publisherClient: MessagingClient;

  beforeAll(async () => {
    prisma = new PrismaService(databaseUrl as string);
    repository = new PrismaAuditEventRepository(prisma);
    await prisma.auditEvent.deleteMany();

    consumerClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'audit-int-consumer',
    });
    publisherClient = new MessagingClient({
      url: rabbitmqUrl as string,
      serviceName: 'audit-int-publisher',
    });

    const consumer = new EventLogConsumer(
      consumerClient,
      new RecordAuditEventUseCase(repository, new SystemClock()),
    );
    await consumer.start();
  });

  afterAll(async () => {
    await publisherClient.close();
    await consumerClient.close();
    await prisma.auditEvent.deleteMany();
    await prisma.$disconnect();
  });

  it('records a contracted event type published through the client', async () => {
    const ticketId = randomUUID();
    const contracted = await publisherClient.publish(ticketCreatedV1, {
      ticketId,
      requesterId: randomUUID(),
      title: 'Audit int test',
      priority: 'low',
      status: 'open',
      createdAt: '2026-07-28T12:00:00.000Z',
    });

    const recorded = await waitFor(() =>
      prisma.auditEvent.findUnique({ where: { id: contracted.id } }),
    );
    expect(recorded.type).toBe('ticket.created.v1');
    expect(recorded.payload).toMatchObject({ ticketId });
  });

  it('records event types the consumer has no contract for', async () => {
    const envelope = await publisherClient.publish(wormholeOpenedV9, {
      sector: 7,
    });

    const recorded = await waitFor(() =>
      prisma.auditEvent.findUnique({ where: { id: envelope.id } }),
    );
    expect(recorded.type).toBe('wormhole.opened.v9');
    expect(recorded.payload).toEqual({ sector: 7 });
  });

  it('collapses recording the same envelope twice into one row (real ON CONFLICT)', async () => {
    const useCase = new RecordAuditEventUseCase(repository, new SystemClock());
    const envelope = {
      id: randomUUID(),
      type: 'ticket.created.v1',
      occurredAt: '2026-07-28T12:00:00.000Z',
      payload: { redelivered: true },
    };

    await useCase.execute(envelope);
    const first = await prisma.auditEvent.findUnique({
      where: { id: envelope.id },
    });
    await useCase.execute(envelope);

    const rows = await prisma.auditEvent.findMany({
      where: { id: envelope.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].recordedAt).toEqual(first?.recordedAt);
  });
});
