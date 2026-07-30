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
  /**
   * Tenant this event belongs to, stamped on the envelope.
   *
   * A v2 contract must always be published with one. Nothing here enforces
   * that — `buildEnvelope` validates the payload and never the envelope — so
   * the check belongs at the call site, where the reason for a missing tenant
   * is still known and can be logged.
   */
  organizationId?: string;
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

export interface FirehoseSubscription {
  /** Durable queue owned by the consuming service: `<service>.<purpose>`. */
  queue: string;
  /** Topic binding patterns, e.g. ['#'] to capture every event. */
  patterns: readonly string[];
  /** Unacked message ceiling per consumer (default 10). */
  prefetch?: number;
  /**
   * Invoked once per delivered event with the payload left OPAQUE: only the
   * envelope is validated, so unknown event types are delivered instead of
   * dead-lettered. Throwing rejects the message to the dead letter queue —
   * delivery is at-least-once, so handlers MUST be idempotent.
   */
  handler: (event: EventEnvelope) => Promise<void>;
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
    ...(options?.organizationId
      ? { organizationId: options.organizationId }
      : {}),
    payload: parsed,
  };
}

export type DecodedDelivery =
  { ok: true; event: EventEnvelope } | { ok: false; reason: string };

/**
 * Validates only the envelope and leaves the payload opaque. This is the
 * decode step for capture-all consumers (audit-style) that must accept
 * event types they have no contract for. Pure for broker-free testing.
 */
export function decodeRawDelivery(content: Buffer): DecodedDelivery {
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

  return { ok: true, event: envelope.data };
}

/**
 * Turns a raw delivery into a validated event, or a rejection reason.
 * Pure so the consumer-side guarantees are testable without a broker.
 */
export function decodeDelivery(
  content: Buffer,
  contractsByType: ReadonlyMap<string, EventContract>,
): DecodedDelivery {
  const decoded = decodeRawDelivery(content);
  if (!decoded.ok) {
    return decoded;
  }

  const contract = contractsByType.get(decoded.event.type);
  if (!contract) {
    return {
      ok: false,
      reason: `no contract bound for type "${decoded.event.type}"`,
    };
  }

  const payload = contract.payloadSchema.safeParse(decoded.event.payload);
  if (!payload.success) {
    return {
      ok: false,
      reason: `payload failed validation for "${decoded.event.type}"`,
    };
  }

  return { ok: true, event: { ...decoded.event, payload: payload.data } };
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
    const contractsByType: ReadonlyMap<string, EventContract> = new Map(
      subscription.contracts.map((contract) => [contract.type, contract]),
    );
    await this.startConsumer(
      subscription.queue,
      subscription.contracts.map((contract) => contract.type),
      subscription.prefetch,
      (channel, message) =>
        this.deliver(
          channel,
          subscription.queue,
          message,
          decodeDelivery(message.content, contractsByType),
          subscription.handler as (event: EventEnvelope) => Promise<void>,
        ),
    );
  }

  /**
   * Capture-all variant of subscribe, EXCLUSIVELY for schema-on-read
   * consumers (audit-style firehose). It binds arbitrary topic patterns and
   * validates only the envelope, so events with no local contract are
   * delivered (payload opaque) instead of dead-lettered. Every domain
   * consumer must keep using subscribe() with explicit contracts — this
   * method deliberately gives up the payload-validation and drift-detection
   * guarantees that make versioned contracts work.
   * Same durable queue + DLQ topology as subscribe().
   */
  async subscribeFirehose(subscription: FirehoseSubscription): Promise<void> {
    await this.startConsumer(
      subscription.queue,
      subscription.patterns,
      subscription.prefetch,
      (channel, message) =>
        this.deliver(
          channel,
          subscription.queue,
          message,
          decodeRawDelivery(message.content),
          subscription.handler,
        ),
    );
  }

  async close(): Promise<void> {
    await this.connection.close();
  }

  /** Nest lifecycle hook (duck-typed): closes the connection on shutdown. */
  async onApplicationShutdown(): Promise<void> {
    await this.close();
  }

  /** Declares the shared consumer topology and starts consuming. */
  private async startConsumer(
    queue: string,
    bindingKeys: readonly string[],
    prefetch: number | undefined,
    onMessage: (
      channel: ChannelWrapper,
      message: ConsumeMessage,
    ) => Promise<void>,
  ): Promise<void> {
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
        for (const key of bindingKeys) {
          await raw.bindQueue(queue, EVENTS_EXCHANGE, key);
        }
        await raw.prefetch(prefetch ?? 10);
      },
    });

    await channel.consume(
      queue,
      (message) => {
        void onMessage(channel, message);
      },
      { noAck: false },
    );
    await channel.waitForConnect();
  }

  private async deliver(
    channel: ChannelWrapper,
    queue: string,
    message: ConsumeMessage,
    decoded: DecodedDelivery,
    handler: (event: EventEnvelope) => Promise<void>,
  ): Promise<void> {
    if (!decoded.ok) {
      this.options.logger?.warn(
        `messaging: rejecting message on "${queue}" to dead letter queue (${decoded.reason})`,
      );
      channel.nack(message, false, false);
      return;
    }

    try {
      await handler(decoded.event);
      channel.ack(message);
    } catch (error) {
      this.options.logger?.warn(
        `messaging: handler failed for "${decoded.event.type}" on "${queue}"; dead-lettering (${
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
