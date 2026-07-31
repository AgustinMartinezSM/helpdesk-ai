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
  organizationId: ORGANIZATION_ID,
};

describe('RabbitMqEventPublisher — v2 only', () => {
  it('publishes exactly one v2 event, tenant and trace on the envelope', async () => {
    const { messaging, publisher } = build();

    await publisher.publishTicketCreated(createdEvent);

    // One publish per fact: phase 8 closed the dual-publish window, so a
    // second v1 copy here would be a regression, not compatibility.
    expect(messaging.typesOf()).toEqual(['ticket.created.v2']);
    expect(messaging.published[0].options?.organizationId).toBe(
      ORGANIZATION_ID,
    );
    expect(messaging.published[0].options?.correlationId).toBe(TRACE_ID);
  });

  it('keeps the tenant off the payload', async () => {
    const { messaging, publisher } = build();

    await publisher.publishTicketCreated(createdEvent);

    expect(messaging.published[0].payload).not.toHaveProperty('organizationId');
  });

  it('never warns on the happy path — the skip-and-warn branch is gone', async () => {
    const { logger, publisher } = build();

    await publisher.publishTicketCreated(createdEvent);

    // The "caller has no organization" skip died with phase 8: the domain
    // types have required an organization since the write-path phase, so
    // there is nothing left to warn about.
    expect(logger.warnings).toEqual([]);
    expect(logger.errors).toEqual([]);
  });

  it('publishes the v2 revision for every ticket event', async () => {
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
      'ticket.status-changed.v2',
      'ticket.assigned.v2',
      'ticket.comment-added.v2',
    ]);
    expect(
      messaging.published.every(
        (entry) => entry.options?.organizationId === ORGANIZATION_ID,
      ),
    ).toBe(true);
  });

  it('stays best-effort: a broker failure is logged, never rethrown', async () => {
    const { logger } = build();
    const failing = {
      async publish() {
        throw new Error('broker unavailable');
      },
      async close() {
        // not used by this spec
      },
    };
    const isolated = new RabbitMqEventPublisher(
      failing as unknown as MessagingClient,
      logger,
    );

    // The mutation already committed when this runs; the request must not
    // fail because the (single) publish did.
    await expect(
      isolated.publishTicketCreated(createdEvent),
    ).resolves.toBeUndefined();
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('ticket.created.v2');
  });

  it('closes its messaging client on shutdown', async () => {
    const { messaging, publisher } = build();
    await publisher.onApplicationShutdown();
    expect(messaging.closed).toBe(true);
  });
});
