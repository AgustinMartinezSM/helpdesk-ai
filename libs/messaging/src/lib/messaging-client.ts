import { randomUUID } from 'node:crypto';
import { connect } from 'amqp-connection-manager';
import type {
  AmqpConnectionManager,
  Channel,
  ChannelWrapper,
} from 'amqp-connection-manager';
import type { ConsumeMessage } from 'amqplib';
import {
  eventEnvelopeSchema,
  type ContractEnvelope,
  type EventContract,
  type EventEnvelope,
} from './contracts.js';
import {
  EVENTS_DEAD_LETTER_EXCHANGE,
  EVENTS_EXCHANGE,
  deadLetterQueueOf,
} from './topology.js';

/** Structural subset of Nest's LoggerService; console satisfies it too. */
export interface MessagingLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface MessagingClientOptions {
  /** amqp:// connection URL, already validated by the service's env schema. */
  url: string;
  /**
   * Logical service name; shows up as the connection name in the management
   * UI and as appId on every published message.
   */
  serviceName: string;
  logger?: MessagingLogger;
}

export interface PublishOptions {
  correlationId?: string;
}

export interface EventSubscription<
  TContract extends EventContract<string, unknown>,
> {
  /** Durable queue owned by the consuming service: `<service>.<purpose>`. */
  queue: string;
  /** Contracts this queue consumes; each type becomes one binding. */
  contracts: readonly TContract[];
  /** Unacked message ceiling per consumer (default 10). */
  prefetch?: number;
  /**
   * Invoked once per delivered event. Throwing rejects the message to the
   * dead letter queue — delivery is at-least-once, so handlers MUST be
   * idempotent.
   */
  handler: (event: ContractEnvelope<TContract>) => Promise<void>;
}

/**
 * Validates and wraps an event the way `MessagingClient.publish` does.
 * Exported separately so producer-side guarantees are testable without a
 * broker. Throws if the payload violates the contract: a malformed event is
 * a bug in the calling service, not something consumers should discover.
 */
export function buildEnvelope<TType extends string, TPayload>(
  contract: EventContract<TType, TPayload>,
  payload: TPayload,
  options?: PublishOptions,
): EventEnvelope<TType, TPayload> {
  const parsed = contract.payloadSchema.parse(payload);
  return {
    id: randomUUID(),
    type: contract.type,
    occurredAt: new Date().toISOString(),
    ...(options?.correlationId ? { correlationId: options.correlationId } : {}),
    payload: parsed,
  };
}

export type DecodedDelivery =
  { ok: true; event: EventEnvelope } | { ok: false; reason: string };

/**
 * Turns a raw delivery into a validated event, or a rejection reason.
 * Pure so the consumer-side guarantees are testable without a broker.
 */
export function decodeDelivery(
  content: Buffer,
  contractsByType: ReadonlyMap<string, EventContract>,
): DecodedDelivery {
  let raw: unknown;
  try {
    raw = JSON.parse(content.toString('utf-8'));
  } catch {
    return { ok: false, reason: 'body is not valid JSON' };
  }

  const envelope = eventEnvelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return { ok: false, reason: 'envelope failed validation' };
  }

  const contract = contractsByType.get(envelope.data.type);
  if (!contract) {
    return {
      ok: false,
      reason: `no contract bound for type "${envelope.data.type}"`,
    };
  }

  const payload = contract.payloadSchema.safeParse(envelope.data.payload);
  if (!payload.success) {
    return {
      ok: false,
      reason: `payload failed validation for "${envelope.data.type}"`,
    };
  }

  return { ok: true, event: { ...envelope.data, payload: payload.data } };
}

/**
 * Thin client over amqp-connection-manager: auto-reconnects, re-runs
 * topology setup and re-subscribes consumers after a broker restart, and
 * resolves publishes only on broker confirm.
 *
 * Delivery semantics are at-least-once. Failed messages are NOT retried:
 * they dead-letter immediately into `<queue>.dlq` for inspection and manual
 * replay (see docs/architecture/messaging.md).
 */
export class MessagingClient {
  private readonly connection: AmqpConnectionManager;
  private publishChannel?: ChannelWrapper;

  constructor(private readonly options: MessagingClientOptions) {
    this.connection = connect([options.url], {
      heartbeatIntervalInSeconds: 30,
      connectionOptions: {
        clientProperties: { connection_name: options.serviceName },
      },
    });
    this.connection.on('connect', () => {
      options.logger?.log('messaging: connected to RabbitMQ');
    });
    this.connection.on('disconnect', ({ err }) => {
      options.logger?.warn(
        `messaging: disconnected from RabbitMQ (${err?.message ?? 'unknown reason'}); reconnecting`,
      );
    });
    this.connection.on('connectFailed', ({ err }) => {
      options.logger?.error(
        `messaging: connection attempt failed (${err?.message ?? 'unknown reason'})`,
      );
    });
  }

  /**
   * Publishes one event to the shared topic exchange. Resolves when the
   * broker confirms the persistent message; while disconnected the publish
   * is buffered and confirmed after reconnection.
   */
  async publish<TType extends string, TPayload>(
    contract: EventContract<TType, TPayload>,
    payload: TPayload,
    options?: PublishOptions,
  ): Promise<EventEnvelope<TType, TPayload>> {
    const envelope = buildEnvelope(contract, payload, options);
    await this.publisherChannel().publish(
      EVENTS_EXCHANGE,
      contract.type,
      Buffer.from(JSON.stringify(envelope)),
      {
        persistent: true,
        contentType: 'application/json',
        messageId: envelope.id,
        type: contract.type,
        appId: this.options.serviceName,
        correlationId: options?.correlationId,
      },
    );
    return envelope;
  }

  /**
   * Declares the queue (+ bindings + dead letter pair) and starts consuming.
   * Resolves once the initial topology setup has completed against a live
   * connection.
   */
  async subscribe<TContract extends EventContract<string, unknown>>(
    subscription: EventSubscription<TContract>,
  ): Promise<void> {
    const { queue, contracts, prefetch = 10 } = subscription;
    const contractsByType: ReadonlyMap<string, EventContract> = new Map(
      contracts.map((contract) => [contract.type, contract]),
    );
    const deadLetterQueue = deadLetterQueueOf(queue);

    const channel = this.connection.createChannel({
      setup: async (raw: Channel) => {
        await raw.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
        await raw.assertExchange(EVENTS_DEAD_LETTER_EXCHANGE, 'direct', {
          durable: true,
        });
        await raw.assertQueue(deadLetterQueue, { durable: true });
        await raw.bindQueue(
          deadLetterQueue,
          EVENTS_DEAD_LETTER_EXCHANGE,
          queue,
        );
        await raw.assertQueue(queue, {
          durable: true,
          deadLetterExchange: EVENTS_DEAD_LETTER_EXCHANGE,
          deadLetterRoutingKey: queue,
        });
        for (const contract of contracts) {
          await raw.bindQueue(queue, EVENTS_EXCHANGE, contract.type);
        }
        await raw.prefetch(prefetch);
      },
    });

    await channel.consume(
      queue,
      (message) => {
        void this.dispatch(channel, contractsByType, subscription, message);
      },
      { noAck: false },
    );
    await channel.waitForConnect();
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  /** Nest lifecycle hook (duck-typed): closes the connection on shutdown. */
  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  private async dispatch<TContract extends EventContract<string, unknown>>(
    channel: ChannelWrapper,
    contractsByType: ReadonlyMap<string, EventContract>,
    subscription: EventSubscription<TContract>,
    message: ConsumeMessage,
  ): Promise<void> {
    const decoded = decodeDelivery(message.content, contractsByType);
    if (!decoded.ok) {
      this.options.logger?.warn(
        `messaging: rejecting message on "${subscription.queue}" to dead letter queue (${decoded.reason})`,
      );
      channel.nack(message, false, false);
      return;
    }

    try {
      await subscription.handler(decoded.event as ContractEnvelope<TContract>);
      channel.ack(message);
    } catch (error) {
      this.options.logger?.warn(
        `messaging: handler failed for "${decoded.event.type}" on "${subscription.queue}"; dead-lettering (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      channel.nack(message, false, false);
    }
  }

  private publisherChannel(): ChannelWrapper {
    this.publishChannel ??= this.connection.createChannel({
      setup: (raw: Channel) =>
        raw.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true }),
    });
    return this.publishChannel;
  }
}
