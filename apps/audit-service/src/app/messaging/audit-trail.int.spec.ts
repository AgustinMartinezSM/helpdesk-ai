/**
 * The sprint's key integration for audit: events published to the real
 * broker — one with a platform contract, one the consumer has never heard
 * of — both land as rows in the real database through the actual firehose
 * consumer, and recording the same envelope twice collapses into one row.
 * Tenancy rides along end to end: a v2 envelope's organizationId is
 * persisted on the row, and a tenantless v2 dead-letters instead of landing.
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
import { connect as amqplibConnect } from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { z } from '@helpdesk-ai/configuration';
import {
  MessagingClient,
  deadLetterQueueOf,
  defineEvent,
  ticketCreatedV1,
  ticketCreatedV2,
} from '@helpdesk-ai/messaging';
import { SystemClock } from '../../application/ports/audit-event.repository';
import { RecordAuditEventUseCase } from '../../application/use-cases/record-audit-event';
import { PrismaAuditEventRepository } from '../../infrastructure/prisma/prisma-audit-event.repository';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { EVENT_LOG_QUEUE, EventLogConsumer } from './event-log.consumer';

const databaseUrl = process.env.DATABASE_URL;
const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!databaseUrl || !rabbitmqUrl) {
  throw new Error(
    'DATABASE_URL and RABBITMQ_URL must be set. Run via `nx run @helpdesk-ai/audit-service:test-integration` with the compose stack up.',
  );
}

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

const DLQ = deadLetterQueueOf(EVENT_LOG_QUEUE);

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
  let rawConnection: ChannelModel;
  let rawChannel: Channel;

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

    // Raw side channel to inspect the DLQ, same as the messaging lib's own
    // int spec. Purged up front for the same reason the table is wiped: on
    // the shared local broker the dead letters of earlier runs are noise.
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
    // v1 rows archive the compatibility window: no tenant to persist.
    expect(recorded.organizationId).toBeNull();
  });

  it('records event types the consumer has no contract for', async () => {
    // v9 is tenant-carrying by the version half of the rule, so even a type
    // the consumer has never heard of must bring its tenant along.
    const envelope = await publisherClient.publish(
      wormholeOpenedV9,
      { sector: 7 },
      { organizationId: ORGANIZATION_ID },
    );

    const recorded = await waitFor(() =>
      prisma.auditEvent.findUnique({ where: { id: envelope.id } }),
    );
    expect(recorded.type).toBe('wormhole.opened.v9');
    expect(recorded.payload).toEqual({ sector: 7 });
    expect(recorded.organizationId).toBe(ORGANIZATION_ID);
  });

  it('dead-letters a v2 envelope published without its tenant, recording nothing', async () => {
    // publish() without the organizationId option: buildEnvelope skips the
    // field entirely, which is exactly how a misbehaving producer would put
    // a tenantless v2 on the bus.
    const envelope = await publisherClient.publish(ticketCreatedV2, {
      ticketId: randomUUID(),
      requesterId: randomUUID(),
      title: 'Audit int test (tenantless)',
      priority: 'low',
      status: 'open',
      createdAt: '2026-07-31T12:00:00.000Z',
    });

    // Each probe pops one message; strays from other local activity are
    // dropped, and only this run's envelope id ends the wait.
    const deadLettered = await waitFor(async () => {
      const message = await rawChannel.get(DLQ, { noAck: true });
      if (message === false) {
        return null;
      }
      const body = JSON.parse(message.content.toString('utf-8')) as {
        id: string;
        type: string;
      };
      return body.id === envelope.id ? body : null;
    });

    expect(deadLettered.type).toBe('ticket.created.v2');
    // Rejected before recording: the dead letter is the only trace of it.
    expect(
      await prisma.auditEvent.findUnique({ where: { id: envelope.id } }),
    ).toBeNull();
  });

  it('records both versions of one fact as two rows, joined by the trace id', async () => {
    const ticketId = randomUUID();
    const traceId = `int-${randomUUID()}`;
    const payload = {
      ticketId,
      requesterId: randomUUID(),
      title: 'Audit int test',
      priority: 'low' as const,
      status: 'open' as const,
      createdAt: '2026-07-30T12:00:00.000Z',
    };

    const v1 = await publisherClient.publish(ticketCreatedV1, payload, {
      correlationId: traceId,
    });
    const v2 = await publisherClient.publish(ticketCreatedV2, payload, {
      correlationId: traceId,
      organizationId: ORGANIZATION_ID,
    });

    await waitFor(async () => {
      const rows = await prisma.auditEvent.findMany({
        where: { id: { in: [v1.id, v2.id] } },
      });
      return rows.length === 2 ? rows : null;
    });

    // This duplication is the accepted cost of the compatibility window, not
    // a bug. The firehose binds '#', so it receives both versions; the two
    // envelopes have different ids, so the id-keyed dedupe that collapses a
    // redelivery cannot collapse these. Anything counting audit rows per
    // logical fact double-counts until v1 stops being published.
    const [rowV1, rowV2] = await Promise.all([
      prisma.auditEvent.findUniqueOrThrow({ where: { id: v1.id } }),
      prisma.auditEvent.findUniqueOrThrow({ where: { id: v2.id } }),
    ]);

    expect(rowV1.type).toBe('ticket.created.v1');
    expect(rowV2.type).toBe('ticket.created.v2');
    expect(rowV2.payload).toEqual(rowV1.payload);
    // The trace id is the only handle that groups them back into one fact.
    expect(rowV1.correlationId).toBe(traceId);
    expect(rowV2.correlationId).toBe(traceId);
    // The tenant lands only where the envelope carried it: the v2 row owns
    // it, the v1 row waits for the operator backfill.
    expect(rowV1.organizationId).toBeNull();
    expect(rowV2.organizationId).toBe(ORGANIZATION_ID);
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
