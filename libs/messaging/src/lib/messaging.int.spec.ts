/**
 * Integration coverage against a real RabbitMQ: publish→consume round trip
 * with broker confirms, and dead-lettering of undecodable messages.
 *
 * Requires the compose stack (`pnpm infra:up`); run via
 * `nx run @helpdesk-ai/messaging:test-integration`, which injects
 * RABBITMQ_URL pointing at the local broker.
 */
import { connect as amqplibConnect } from 'amqplib';
import type { Channel, ChannelModel } from 'amqplib';
import { ticketCreatedV1, userRegisteredV1 } from './contracts.js';
import { MessagingClient } from './messaging-client.js';
import type { ContractEnvelope, EventEnvelope } from './contracts.js';
import { EVENTS_EXCHANGE, deadLetterQueueOf } from './topology.js';

const rabbitmqUrl = process.env.RABBITMQ_URL;
if (!rabbitmqUrl) {
  throw new Error(
    'RABBITMQ_URL is not set. Run via `nx run @helpdesk-ai/messaging:test-integration` with the compose stack up.',
  );
}

const QUEUE = 'messaging-lib.int-test';
const DLQ = deadLetterQueueOf(QUEUE);
const FIREHOSE_QUEUE = 'messaging-lib.int-test-firehose';
const FIREHOSE_DLQ = deadLetterQueueOf(FIREHOSE_QUEUE);

const ticketPayload = {
  ticketId: '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222',
  requesterId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  title: 'Printer on fire',
  priority: 'high' as const,
  status: 'open' as const,
  createdAt: '2026-07-28T12:00:00.000Z',
};

async function waitFor(
  condition: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('condition not met within timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('MessagingClient against a real broker', () => {
  let client: MessagingClient;
  let rawConnection: ChannelModel;
  let rawChannel: Channel;
  const received: ContractEnvelope<typeof ticketCreatedV1>[] = [];
  const firehoseReceived: EventEnvelope[] = [];

  beforeAll(async () => {
    client = new MessagingClient({
      url: rabbitmqUrl,
      serviceName: 'messaging-int-test',
    });
    await client.subscribe({
      queue: QUEUE,
      contracts: [ticketCreatedV1],
      handler: async (event) => {
        received.push(event);
      },
    });
    await client.subscribeFirehose({
      queue: FIREHOSE_QUEUE,
      patterns: ['#'],
      handler: async (event) => {
        firehoseReceived.push(event);
      },
    });

    // Raw side channel to inject malformed messages and inspect the DLQ.
    rawConnection = await amqplibConnect(rabbitmqUrl);
    rawChannel = await rawConnection.createChannel();
    await rawChannel.purgeQueue(QUEUE);
    await rawChannel.purgeQueue(DLQ);
    await rawChannel.purgeQueue(FIREHOSE_QUEUE);
    await rawChannel.purgeQueue(FIREHOSE_DLQ);
  });

  afterAll(async () => {
    await rawChannel.deleteQueue(QUEUE);
    await rawChannel.deleteQueue(DLQ);
    await rawChannel.deleteQueue(FIREHOSE_QUEUE);
    await rawChannel.deleteQueue(FIREHOSE_DLQ);
    await rawConnection.close();
    await client.close();
  });

  it('delivers a published event to a bound consumer', async () => {
    const envelope = await client.publish(ticketCreatedV1, ticketPayload, {
      correlationId: 'int-test-correlation',
    });

    await waitFor(() => received.length === 1);
    expect(received[0]).toEqual(envelope);
  });

  it('delivers every event type to a firehose subscriber, contract or not', async () => {
    const before = firehoseReceived.length;
    const userEnvelope = await client.publish(userRegisteredV1, {
      userId: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
      email: 'ada@example.com',
      roles: ['user'],
      registeredAt: '2026-07-28T12:00:00.000Z',
    });

    await waitFor(() =>
      firehoseReceived.some((event) => event.id === userEnvelope.id),
    );
    // The firehose queue has no user.registered.v1 contract bound — the
    // envelope-only decode is what lets it through.
    const seen = firehoseReceived.find((e) => e.id === userEnvelope.id);
    expect(seen?.type).toBe('user.registered.v1');
    expect(seen?.payload).toEqual(userEnvelope.payload);
    expect(firehoseReceived.length).toBeGreaterThan(before);
  });

  it('dead-letters messages that cannot be decoded, without invoking the handler', async () => {
    const before = received.length;
    rawChannel.publish(
      EVENTS_EXCHANGE,
      ticketCreatedV1.type,
      Buffer.from('{"broken":'),
      { persistent: true },
    );

    let deadLettered: Awaited<ReturnType<Channel['get']>> = false;
    const deadline = Date.now() + 5_000;
    while (deadLettered === false && Date.now() < deadline) {
      deadLettered = await rawChannel.get(DLQ, { noAck: true });
      if (deadLettered === false) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    expect(deadLettered).not.toBe(false);
    if (deadLettered !== false) {
      expect(deadLettered.content.toString('utf-8')).toBe('{"broken":');
    }
    expect(received.length).toBe(before);
  });
});
