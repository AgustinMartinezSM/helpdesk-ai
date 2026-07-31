import type {
  EventSubscription,
  MessagingClient,
  EventContract,
} from '@helpdesk-ai/messaging';
import { userRegisteredV1 } from '@helpdesk-ai/messaging';
import {
  FakeOrganizationEventPublisher,
  FixedClock,
  InMemoryMembershipRepository,
  InMemoryOrganizationRepository,
  SequentialIdGenerator,
} from '../../application/testing/fakes';
import { EnsureMembershipUseCase } from '../../application/use-cases/ensure-membership';
import {
  RegistrationConsumer,
  USER_REGISTERED_QUEUE,
} from './registration.consumer';

type AnySubscription = EventSubscription<EventContract<string, unknown>>;

const BOOTSTRAP_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '11111111-1111-4111-8111-111111111111';

class CapturingMessagingClient {
  subscription?: AnySubscription;
  closed = false;

  async subscribe(subscription: AnySubscription): Promise<void> {
    this.subscription = subscription;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

function buildConsumer() {
  const organizations = new InMemoryOrganizationRepository();
  organizations.add({
    id: BOOTSTRAP_ID,
    slug: 'bootstrap',
    name: 'Bootstrap organization',
    status: 'active',
    createdAt: new Date('2026-07-30T00:00:00.000Z'),
    updatedAt: new Date('2026-07-30T00:00:00.000Z'),
  });
  const memberships = new InMemoryMembershipRepository();
  const messaging = new CapturingMessagingClient();
  const events = new FakeOrganizationEventPublisher();
  const consumer = new RegistrationConsumer(
    messaging as unknown as MessagingClient,
    new EnsureMembershipUseCase(
      organizations,
      memberships,
      new FixedClock(new Date('2026-07-30T12:00:05.000Z')),
      new SequentialIdGenerator(),
      events,
    ),
  );
  return { organizations, memberships, messaging, events, consumer };
}

function envelope(roles: string[], correlationId?: string) {
  return {
    id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
    type: 'user.registered.v1',
    occurredAt: '2026-07-30T12:00:00.000Z',
    ...(correlationId ? { correlationId } : {}),
    payload: {
      userId: USER_ID,
      email: 'ada@example.com',
      roles,
      registeredAt: '2026-07-30T12:00:00.000Z',
    },
  };
}

describe('RegistrationConsumer', () => {
  it('subscribes its own durable queue to user.registered.v1 and creates a membership', async () => {
    const { messaging, memberships, consumer } = buildConsumer();

    await consumer.start();

    expect(messaging.subscription?.queue).toBe(USER_REGISTERED_QUEUE);
    expect(
      messaging.subscription?.contracts.map((contract) => contract.type),
    ).toEqual([userRegisteredV1.type]);

    await messaging.subscription?.handler(envelope(['user', 'admin']));

    const stored = await memberships.findByOrganizationAndUser(
      BOOTSTRAP_ID,
      USER_ID,
    );
    expect(stored?.roleTemplate).toBe('organization_admin');
    expect(stored?.status).toBe('active');
  });

  it('does not share a queue with the other consumers of the same event', () => {
    // users-service and analytics-service bind the same routing key on their
    // own queues; sharing one would make the three services compete for
    // deliveries instead of each receiving every event.
    expect(USER_REGISTERED_QUEUE).toBe('organizations-service.user-registered');
  });

  it('stays idempotent across redelivery', async () => {
    const { messaging, memberships, events, consumer } = buildConsumer();
    await consumer.start();

    await messaging.subscription?.handler(envelope(['user']));
    await messaging.subscription?.handler(envelope(['user']));

    expect(memberships.memberships).toHaveLength(1);
    // And so does what it announces: one membership, one created event.
    expect(events.created).toHaveLength(1);
  });

  it('threads the envelope correlation id into the published event', async () => {
    const { messaging, events, consumer } = buildConsumer();
    await consumer.start();

    await messaging.subscription?.handler(envelope(['user'], 'req-abc'));

    // The registration and the membership it caused group under one trace,
    // which is the only thing that joins them in the audit trail.
    expect(events.created).toHaveLength(1);
    expect(events.created[0].correlationId).toBe('req-abc');
  });

  it('closes its messaging client on shutdown', async () => {
    const { messaging, consumer } = buildConsumer();

    await consumer.onApplicationShutdown();
    expect(messaging.closed).toBe(true);
  });
});
