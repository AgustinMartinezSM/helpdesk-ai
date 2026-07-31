import type {
  EventContract,
  MessagingClient,
  PublishOptions,
} from '@helpdesk-ai/messaging';
import type { Membership } from '../../domain/membership';
import { RabbitMqEventPublisher } from './rabbitmq-event-publisher';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TRACE_ID = 'req-123';

interface RecordedPublish {
  type: string;
  payload: unknown;
  options?: PublishOptions;
}

class RecordingMessagingClient {
  readonly published: RecordedPublish[] = [];

  async publish(
    contract: EventContract<string, unknown>,
    payload: unknown,
    options?: PublishOptions,
  ): Promise<void> {
    this.published.push({ type: contract.type, payload, options });
  }
}

class RecordingLogger {
  readonly errors: string[] = [];

  log(): void {
    // The adapter never logs at this level; present to satisfy the interface.
  }

  warn(): void {
    // Nor at this one: there is no skip case to warn about.
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

function membership(overrides: Partial<Membership> = {}): Membership {
  return {
    id: MEMBERSHIP_ID,
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    roleTemplate: 'agent',
    status: 'active',
    version: 1,
    createdAt: new Date('2026-07-30T12:00:00.000Z'),
    updatedAt: new Date('2026-07-30T12:00:00.000Z'),
    ...overrides,
  };
}

describe('RabbitMqEventPublisher (memberships)', () => {
  it('publishes membership.created.v1 with the tenant on the envelope', async () => {
    const { messaging, publisher } = build();

    await publisher.membershipCreated(membership(), TRACE_ID);

    expect(messaging.published).toHaveLength(1);
    const [event] = messaging.published;
    expect(event.type).toBe('membership.created.v1');
    // The envelope, not just the payload: consumers that route on tenancy
    // without knowing this schema read it there, and these contracts are
    // born tenant-carrying — there is no skip case.
    expect(event.options?.organizationId).toBe(ORGANIZATION_ID);
    expect(event.options?.correlationId).toBe(TRACE_ID);
    expect(event.payload).toEqual({
      membershipId: MEMBERSHIP_ID,
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      roleTemplate: 'agent',
      status: 'active',
      createdAt: '2026-07-30T12:00:00.000Z',
    });
  });

  it('publishes membership.status-changed.v1 with both statuses and the bumped version', async () => {
    const { messaging, publisher } = build();

    await publisher.membershipStatusChanged(
      membership({
        status: 'suspended',
        version: 2,
        updatedAt: new Date('2026-07-30T13:00:00.000Z'),
      }),
      'active',
    );

    const [event] = messaging.published;
    expect(event.type).toBe('membership.status-changed.v1');
    expect(event.options?.organizationId).toBe(ORGANIZATION_ID);
    expect(event.payload).toEqual({
      membershipId: MEMBERSHIP_ID,
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      fromStatus: 'active',
      toStatus: 'suspended',
      version: 2,
      changedAt: '2026-07-30T13:00:00.000Z',
    });
  });

  it('omits the correlation id rather than sending an empty one', async () => {
    const { messaging, publisher } = build();

    await publisher.membershipCreated(membership());

    expect(messaging.published[0].options).not.toHaveProperty('correlationId');
  });

  it('swallows and logs a broker failure', async () => {
    // Best-effort per ADR 0006: the row already committed, so the announcement
    // failing must not fail the operation that caused it.
    const logger = new RecordingLogger();
    const failing = {
      async publish(): Promise<never> {
        throw new Error('broker unavailable');
      },
    };
    const publisher = new RabbitMqEventPublisher(
      failing as unknown as MessagingClient,
      logger,
    );

    await expect(
      publisher.membershipCreated(membership()),
    ).resolves.toBeUndefined();
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('membership.created.v1');
  });
});
