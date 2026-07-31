import type {
  EventContract,
  MessagingClient,
  PublishOptions,
} from '@helpdesk-ai/messaging';
import type { Branch, OperationalStation } from '../../domain/branch';
import type { Membership } from '../../domain/membership';
import { RabbitMqEventPublisher } from './rabbitmq-event-publisher';

const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const MEMBERSHIP_ID = '00000000-0000-4000-8000-000000000002';
const BRANCH_ID = '00000000-0000-4000-8000-000000000003';
const STATION_ID = '00000000-0000-4000-8000-000000000004';
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

  it('publishes membership.role-changed.v1 with the pre-change template and the bumped version', async () => {
    const { messaging, publisher } = build();

    await publisher.membershipRoleChanged(
      membership({
        roleTemplate: 'branch_manager',
        version: 2,
        updatedAt: new Date('2026-07-31T13:00:00.000Z'),
      }),
      'requester',
      TRACE_ID,
    );

    const [event] = messaging.published;
    expect(event.type).toBe('membership.role-changed.v1');
    expect(event.options?.organizationId).toBe(ORGANIZATION_ID);
    expect(event.payload).toEqual({
      membershipId: MEMBERSHIP_ID,
      organizationId: ORGANIZATION_ID,
      userId: USER_ID,
      fromTemplate: 'requester',
      toTemplate: 'branch_manager',
      version: 2,
      changedAt: '2026-07-31T13:00:00.000Z',
    });
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

function branch(overrides: Partial<Branch> = {}): Branch {
  return {
    id: BRANCH_ID,
    organizationId: ORGANIZATION_ID,
    code: 'store-12',
    name: 'Store 12',
    status: 'active',
    timezone: 'America/Argentina/Buenos_Aires',
    address: null,
    createdAt: new Date('2026-07-31T12:00:00.000Z'),
    updatedAt: new Date('2026-07-31T12:00:00.000Z'),
    ...overrides,
  };
}

function station(
  overrides: Partial<OperationalStation> = {},
): OperationalStation {
  return {
    id: STATION_ID,
    organizationId: ORGANIZATION_ID,
    branchId: BRANCH_ID,
    code: 'cashier-2',
    name: 'Cashier station 2',
    area: 'checkout',
    responsibleMembershipId: null,
    status: 'active',
    createdAt: new Date('2026-07-31T12:00:00.000Z'),
    updatedAt: new Date('2026-07-31T12:00:00.000Z'),
    ...overrides,
  };
}

describe('RabbitMqEventPublisher (structure)', () => {
  it('publishes branch.created.v1 with the tenant on the envelope', async () => {
    const { messaging, publisher } = build();

    await publisher.branchCreated(branch(), TRACE_ID);

    const [event] = messaging.published;
    expect(event.type).toBe('branch.created.v1');
    // Born tenant-carrying, like the membership events: there is no skip
    // case, and consumers that route on tenancy read the envelope.
    expect(event.options?.organizationId).toBe(ORGANIZATION_ID);
    expect(event.options?.correlationId).toBe(TRACE_ID);
    expect(event.payload).toEqual({
      branchId: BRANCH_ID,
      organizationId: ORGANIZATION_ID,
      code: 'store-12',
      name: 'Store 12',
      status: 'active',
      timezone: 'America/Argentina/Buenos_Aires',
      createdAt: '2026-07-31T12:00:00.000Z',
    });
  });

  it('omits an unset timezone rather than sending a null', async () => {
    // The contract models "never set" as absence; z.optional() does not
    // admit null, so a null column must not reach the wire.
    const { messaging, publisher } = build();

    await publisher.branchCreated(branch({ timezone: null }));

    expect(messaging.published[0].payload).not.toHaveProperty('timezone');
  });

  it('publishes an archive as branch.updated.v1', async () => {
    const { messaging, publisher } = build();

    await publisher.branchUpdated(
      branch({
        status: 'archived',
        updatedAt: new Date('2026-07-31T13:00:00.000Z'),
      }),
    );

    const [event] = messaging.published;
    expect(event.type).toBe('branch.updated.v1');
    expect(event.options?.organizationId).toBe(ORGANIZATION_ID);
    expect(event.payload).toEqual({
      branchId: BRANCH_ID,
      organizationId: ORGANIZATION_ID,
      code: 'store-12',
      name: 'Store 12',
      status: 'archived',
      timezone: 'America/Argentina/Buenos_Aires',
      updatedAt: '2026-07-31T13:00:00.000Z',
    });
  });

  it('publishes station.created.v1 with branch, tenant and area', async () => {
    const { messaging, publisher } = build();

    await publisher.stationCreated(station(), TRACE_ID);

    const [event] = messaging.published;
    expect(event.type).toBe('station.created.v1');
    expect(event.options?.organizationId).toBe(ORGANIZATION_ID);
    expect(event.payload).toEqual({
      stationId: STATION_ID,
      branchId: BRANCH_ID,
      organizationId: ORGANIZATION_ID,
      code: 'cashier-2',
      name: 'Cashier station 2',
      area: 'checkout',
      status: 'active',
      createdAt: '2026-07-31T12:00:00.000Z',
    });
  });

  it('publishes station.updated.v1 without an unset area', async () => {
    const { messaging, publisher } = build();

    await publisher.stationUpdated(
      station({
        area: null,
        status: 'archived',
        updatedAt: new Date('2026-07-31T13:00:00.000Z'),
      }),
    );

    const [event] = messaging.published;
    expect(event.type).toBe('station.updated.v1');
    expect(event.options?.organizationId).toBe(ORGANIZATION_ID);
    expect(event.payload).toEqual({
      stationId: STATION_ID,
      branchId: BRANCH_ID,
      organizationId: ORGANIZATION_ID,
      code: 'cashier-2',
      name: 'Cashier station 2',
      status: 'archived',
      updatedAt: '2026-07-31T13:00:00.000Z',
    });
  });

  it('swallows and logs a broker failure on a structure publish', async () => {
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

    await expect(publisher.branchCreated(branch())).resolves.toBeUndefined();
    expect(logger.errors).toHaveLength(1);
    expect(logger.errors[0]).toContain('branch.created.v1');
  });
});
