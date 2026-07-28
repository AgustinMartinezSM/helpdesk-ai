import type {
  EventContract,
  EventSubscription,
  MessagingClient,
} from '@helpdesk-ai/messaging';
import {
  ApplyTicketCreatedUseCase,
  ApplyTicketStatusChangedUseCase,
  ApplyUserRegisteredUseCase,
} from '../../application/use-cases/apply-events';
import {
  InMemoryTicketSnapshotRepository,
  InMemoryUserSnapshotRepository,
} from '../../application/testing/fakes';
import { METRICS_QUEUE, MetricsConsumer } from './metrics.consumer';

type AnySubscription = EventSubscription<EventContract<string, unknown>>;

class CapturingMessagingClient {
  subscription?: AnySubscription;

  async subscribe(subscription: AnySubscription): Promise<void> {
    this.subscription = subscription;
  }

  async close(): Promise<void> {
    // no-op
  }
}

const TICKET = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';

describe('MetricsConsumer', () => {
  it('subscribes serialized (prefetch 1) to created/status-changed/registered and routes by type', async () => {
    const messaging = new CapturingMessagingClient();
    const tickets = new InMemoryTicketSnapshotRepository();
    const users = new InMemoryUserSnapshotRepository();
    const consumer = new MetricsConsumer(
      messaging as unknown as MessagingClient,
      new ApplyTicketCreatedUseCase(tickets),
      new ApplyTicketStatusChangedUseCase(tickets),
      new ApplyUserRegisteredUseCase(users),
    );

    await consumer.start();

    expect(messaging.subscription?.queue).toBe(METRICS_QUEUE);
    expect(messaging.subscription?.prefetch).toBe(1);
    expect(
      messaging.subscription?.contracts.map((contract) => contract.type),
    ).toEqual([
      'ticket.created.v1',
      'ticket.status-changed.v1',
      'user.registered.v1',
    ]);

    const handler = messaging.subscription!.handler as (
      event: unknown,
    ) => Promise<void>;

    await handler({
      id: '00000000-0000-4000-8000-000000000001',
      type: 'ticket.created.v1',
      occurredAt: '2026-07-28T12:00:00.100Z',
      payload: {
        ticketId: TICKET,
        requesterId: '11111111-1111-4111-8111-111111111111',
        title: 'x',
        priority: 'high',
        status: 'open',
        createdAt: '2026-07-28T12:00:00.000Z',
      },
    });
    await handler({
      id: '00000000-0000-4000-8000-000000000002',
      type: 'ticket.status-changed.v1',
      occurredAt: '2026-07-28T13:00:00.100Z',
      payload: {
        ticketId: TICKET,
        actorId: '33333333-3333-4333-8333-333333333333',
        fromStatus: 'open',
        toStatus: 'resolved',
        changedAt: '2026-07-28T13:00:00.000Z',
      },
    });
    await handler({
      id: '00000000-0000-4000-8000-000000000003',
      type: 'user.registered.v1',
      occurredAt: '2026-07-28T12:00:00.000Z',
      payload: {
        userId: '11111111-1111-4111-8111-111111111111',
        email: 'ada@example.com',
        roles: ['user'],
        registeredAt: '2026-07-28T12:00:00.000Z',
      },
    });

    const snapshot = tickets.snapshots.get(TICKET);
    expect(snapshot?.status).toBe('resolved');
    expect(snapshot?.priority).toBe('high');
    expect(await users.total()).toBe(1);
  });
});
