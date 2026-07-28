import type {
  EventSubscription,
  MessagingClient,
  EventContract,
} from '@helpdesk-ai/messaging';
import { userRegisteredV1 } from '@helpdesk-ai/messaging';
import { RegisterUserProfileUseCase } from '../../application/use-cases/register-user-profile';
import {
  FixedClock,
  InMemoryUserProfileRepository,
} from '../../application/testing/fakes';
import {
  RegistrationConsumer,
  USER_REGISTERED_QUEUE,
} from './registration.consumer';

type AnySubscription = EventSubscription<EventContract<string, unknown>>;

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

describe('RegistrationConsumer', () => {
  it('subscribes its own durable queue to user.registered.v1 and projects deliveries', async () => {
    const messaging = new CapturingMessagingClient();
    const profiles = new InMemoryUserProfileRepository();
    const consumer = new RegistrationConsumer(
      messaging as unknown as MessagingClient,
      new RegisterUserProfileUseCase(
        profiles,
        new FixedClock(new Date('2026-07-28T12:00:05.000Z')),
      ),
    );

    await consumer.start();

    expect(messaging.subscription?.queue).toBe(USER_REGISTERED_QUEUE);
    expect(
      messaging.subscription?.contracts.map((contract) => contract.type),
    ).toEqual([userRegisteredV1.type]);

    await messaging.subscription?.handler({
      id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
      type: 'user.registered.v1',
      occurredAt: '2026-07-28T12:00:00.000Z',
      payload: {
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'ada@example.com',
        roles: ['user'],
        registeredAt: '2026-07-28T12:00:00.000Z',
      },
    });

    const stored = await profiles.findByUserId(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(stored?.email).toBe('ada@example.com');
    expect(stored?.registeredAt).toEqual(new Date('2026-07-28T12:00:00.000Z'));
  });

  it('closes its messaging client on shutdown', async () => {
    const messaging = new CapturingMessagingClient();
    const consumer = new RegistrationConsumer(
      messaging as unknown as MessagingClient,
      new RegisterUserProfileUseCase(
        new InMemoryUserProfileRepository(),
        new FixedClock(new Date()),
      ),
    );

    await consumer.onApplicationShutdown();
    expect(messaging.closed).toBe(true);
  });
});
