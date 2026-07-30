import type {
  EventContract,
  MessagingClient,
  PublishOptions,
} from '@helpdesk-ai/messaging';
import { RabbitMqEventPublisher } from './rabbitmq-event-publisher';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const SUGGESTION_ID = '9b1f2c76-3f4d-4a55-9d21-0b3c5be2b333';
const TICKET_ID = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';
const REQUESTED_BY = '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111';
const TRACE_ID = 'req-123';

class RecordingMessagingClient {
  readonly published: {
    type: string;
    payload: unknown;
    options?: PublishOptions;
  }[] = [];
  closed = false;

  async publish(
    contract: EventContract<string, unknown>,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<void> {
    this.published.push({ type: contract.type, payload, options });
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  typesOf(): string[] {
    return this.published.map((entry) => entry.type);
  }
}

class RecordingLogger {
  readonly warnings: string[] = [];
  readonly errors: string[] = [];

  log(): void {
    // The adapter never logs at this level; present to satisfy the interface.
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  error(message: string): void {
    this.errors.push(message);
  }
}

function build() {
  const messaging = new RecordingMessagingClient();
  const logger = new RecordingLogger();
  const publisher = new RabbitMqEventPublisher(
    messaging as unknown as MessagingClient,
    logger,
  );
  return { messaging, logger, publisher };
}

const suggestionEvent = {
  suggestionId: SUGGESTION_ID,
  ticketId: TICKET_ID,
  task: 'summary' as const,
  provider: 'local',
  model: 'heuristics-v1',
  requestedBy: REQUESTED_BY,
  createdAt: new Date('2026-07-30T12:00:00.000Z'),
  traceId: TRACE_ID,
};

describe('RabbitMqEventPublisher — the compatibility pair', () => {
  it('publishes v1 and v2 with the same payload and trace, tenant on v2 only', async () => {
    const { messaging, publisher } = build();

    await publisher.publishSuggestionCreated({
      ...suggestionEvent,
      organizationId: ORGANIZATION_ID,
    });

    expect(messaging.typesOf()).toEqual([
      'ai.suggestion.created.v1',
      'ai.suggestion.created.v2',
    ]);

    const [v1, v2] = messaging.published;
    expect(v2.payload).toEqual(v1.payload);
    expect(v1.options?.correlationId).toBe(TRACE_ID);
    expect(v2.options?.correlationId).toBe(TRACE_ID);
    expect(v1.options?.organizationId).toBeUndefined();
    expect(v2.options?.organizationId).toBe(ORGANIZATION_ID);
  });

  it('still carries no suggestion content in either version', async () => {
    const { messaging, publisher } = build();

    await publisher.publishSuggestionCreated({
      ...suggestionEvent,
      organizationId: ORGANIZATION_ID,
    });

    // The v2 contract shares the v1 payload schema, so the guarantee that
    // this event is metadata only survives the version bump by construction.
    for (const entry of messaging.published) {
      expect(entry.payload).not.toHaveProperty('output');
      expect(entry.payload).not.toHaveProperty('organizationId');
    }
  });

  it('publishes v1 only, and warns, when the caller has no organization', async () => {
    const { messaging, logger, publisher } = build();

    await publisher.publishSuggestionCreated(suggestionEvent);

    expect(messaging.typesOf()).toEqual(['ai.suggestion.created.v1']);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('ai.suggestion.created.v2');
    expect(logger.warnings[0]).toContain(SUGGESTION_ID);
  });

  it('closes its messaging client on shutdown', async () => {
    const { messaging, publisher } = build();
    await publisher.onApplicationShutdown();
    expect(messaging.closed).toBe(true);
  });
});
