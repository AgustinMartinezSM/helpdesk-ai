import type {
  EventContract,
  MessagingClient,
  PublishOptions,
} from '@helpdesk-ai/messaging';
import { RabbitMqEventPublisher } from './rabbitmq-event-publisher';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const TICKET_ID = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';
const ACTOR_ID = '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111';
const COMMENT_ID = '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f';
const TRACE_ID = 'req-123';

interface RecordedPublish {
  type: string;
  payload: unknown;
  options?: PublishOptions;
}

class RecordingMessagingClient {
  readonly published: RecordedPublish[] = [];
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

const createdEvent = {
  ticketId: TICKET_ID,
  requesterId: ACTOR_ID,
  title: 'Printer on fire',
  priority: 'high' as const,
  status: 'open' as const,
  createdAt: new Date('2026-07-30T12:00:00.000Z'),
  traceId: TRACE_ID,
};

describe('RabbitMqEventPublisher — the compatibility pair', () => {
  it('publishes v1 and v2, differing only in type and tenant', async () => {
    const { messaging, publisher } = build();

    await publisher.publishTicketCreated({
      ...createdEvent,
      organizationId: ORGANIZATION_ID,
    });

    expect(messaging.typesOf()).toEqual([
      'ticket.created.v1',
      'ticket.created.v2',
    ]);

    const [v1, v2] = messaging.published;
    // One payload object, handed to both: the two versions cannot describe
    // the same fact differently.
    expect(v2.payload).toEqual(v1.payload);
    expect(v1.options?.organizationId).toBeUndefined();
    expect(v2.options?.organizationId).toBe(ORGANIZATION_ID);
  });

  it('gives both versions the same correlation id', async () => {
    const { messaging, publisher } = build();

    await publisher.publishTicketCreated({
      ...createdEvent,
      organizationId: ORGANIZATION_ID,
    });

    // The audit trail stores both, and this is the only thing that groups
    // them back into the one request that caused them.
    expect(messaging.published[0].options?.correlationId).toBe(TRACE_ID);
    expect(messaging.published[1].options?.correlationId).toBe(TRACE_ID);
  });

  it('keeps the tenant off the payload', async () => {
    const { messaging, publisher } = build();

    await publisher.publishTicketCreated({
      ...createdEvent,
      organizationId: ORGANIZATION_ID,
    });

    for (const entry of messaging.published) {
      expect(entry.payload).not.toHaveProperty('organizationId');
    }
  });

  it('publishes v1 only, and warns, when the caller has no organization', async () => {
    const { messaging, logger, publisher } = build();

    await publisher.publishTicketCreated(createdEvent);

    // v1 is unconditional: a caller with no tenant must not lose the event
    // every consumer reads today.
    expect(messaging.typesOf()).toEqual(['ticket.created.v1']);
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toContain('ticket.created.v2');
    expect(logger.warnings[0]).toContain(TICKET_ID);
  });

  it('does not warn when the pair went out complete', async () => {
    const { logger, publisher } = build();

    await publisher.publishTicketCreated({
      ...createdEvent,
      organizationId: ORGANIZATION_ID,
    });

    expect(logger.warnings).toEqual([]);
  });

  it('publishes both versions for every ticket event', async () => {
    const { messaging, publisher } = build();

    await publisher.publishTicketStatusChanged({
      ticketId: TICKET_ID,
      actorId: ACTOR_ID,
      fromStatus: 'open',
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-30T12:00:00.000Z'),
      organizationId: ORGANIZATION_ID,
    });
    await publisher.publishTicketAssigned({
      ticketId: TICKET_ID,
      actorId: ACTOR_ID,
      assigneeId: ACTOR_ID,
      assignedAt: new Date('2026-07-30T12:00:00.000Z'),
      organizationId: ORGANIZATION_ID,
    });
    await publisher.publishTicketCommentAdded({
      ticketId: TICKET_ID,
      commentId: COMMENT_ID,
      authorId: ACTOR_ID,
      internal: false,
      addedAt: new Date('2026-07-30T12:00:00.000Z'),
      organizationId: ORGANIZATION_ID,
    });

    expect(messaging.typesOf()).toEqual([
      'ticket.status-changed.v1',
      'ticket.status-changed.v2',
      'ticket.assigned.v1',
      'ticket.assigned.v2',
      'ticket.comment-added.v1',
      'ticket.comment-added.v2',
    ]);
  });

  it.each([
    ['publishTicketStatusChanged', 'ticket.status-changed.v2'],
    ['publishTicketAssigned', 'ticket.assigned.v2'],
    ['publishTicketCommentAdded', 'ticket.comment-added.v2'],
  ] as const)('%s skips its v2 without a tenant', async (method, v2Type) => {
    const { messaging, logger, publisher } = build();
    const base = {
      ticketId: TICKET_ID,
      actorId: ACTOR_ID,
      authorId: ACTOR_ID,
      commentId: COMMENT_ID,
      assigneeId: null,
      internal: false,
      fromStatus: 'open' as const,
      toStatus: 'in_progress' as const,
      changedAt: new Date('2026-07-30T12:00:00.000Z'),
      assignedAt: new Date('2026-07-30T12:00:00.000Z'),
      addedAt: new Date('2026-07-30T12:00:00.000Z'),
    };

    await publisher[method](base);

    expect(messaging.typesOf()).toHaveLength(1);
    expect(messaging.typesOf()[0]).toBe(v2Type.replace('.v2', '.v1'));
    expect(logger.warnings[0]).toContain(v2Type);
  });

  it('lets v2 go out even when v1 failed to publish', async () => {
    const { logger, publisher } = build();
    const failing = {
      published: [] as RecordedPublish[],
      async publish(contract: EventContract<string, unknown>) {
        if (contract.type.endsWith('.v1')) {
          throw new Error('broker unavailable');
        }
        this.published.push({ type: contract.type, payload: null });
      },
      async close() {
        // not used by this spec
      },
    };
    const isolated = new RabbitMqEventPublisher(
      failing as unknown as MessagingClient,
      logger,
    );

    await isolated.publishTicketCreated({
      ...createdEvent,
      organizationId: ORGANIZATION_ID,
    });

    // Two independent best-effort publishes. One failing must not suppress
    // the other, or a broker hiccup would silently desynchronise the streams.
    expect(failing.published.map((entry) => entry.type)).toEqual([
      'ticket.created.v2',
    ]);
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('ticket.created.v1');
    void publisher;
  });

  it('closes its messaging client on shutdown', async () => {
    const { messaging, publisher } = build();
    await publisher.onApplicationShutdown();
    expect(messaging.closed).toBe(true);
  });
});
