import type {
  EventContract,
  EventSubscription,
  MessagingClient,
} from '@helpdesk-ai/messaging';
import {
  NotifyAssignedUseCase,
  NotifyCommentAddedUseCase,
  NotifyStatusChangedUseCase,
  RegisterTicketRefUseCase,
} from '../../application/use-cases/project-ticket-events';
import {
  FixedClock,
  InMemoryNotificationRepository,
  InMemoryTicketRefRepository,
} from '../../application/testing/fakes';
import {
  TICKET_EVENTS_QUEUE,
  TicketEventsConsumer,
} from './ticket-events.consumer';

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

const REQUESTER = '11111111-1111-4111-8111-111111111111';
const AGENT = '33333333-3333-4333-8333-333333333333';
const TICKET = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';

describe('TicketEventsConsumer', () => {
  it('subscribes serialized (prefetch 1) to the four lifecycle contracts and routes by type', async () => {
    const messaging = new CapturingMessagingClient();
    const refs = new InMemoryTicketRefRepository();
    const notifications = new InMemoryNotificationRepository();
    const clock = new FixedClock(new Date('2026-07-28T12:00:05.000Z'));
    const deps = { refs, notifications, clock };
    const consumer = new TicketEventsConsumer(
      messaging as unknown as MessagingClient,
      new RegisterTicketRefUseCase(refs),
      new NotifyStatusChangedUseCase(deps),
      new NotifyAssignedUseCase(deps),
      new NotifyCommentAddedUseCase(deps),
    );

    await consumer.start();

    expect(messaging.subscription?.queue).toBe(TICKET_EVENTS_QUEUE);
    expect(messaging.subscription?.prefetch).toBe(1);
    expect(
      messaging.subscription?.contracts.map((contract) => contract.type),
    ).toEqual([
      'ticket.created.v1',
      'ticket.status-changed.v1',
      'ticket.assigned.v1',
      'ticket.comment-added.v1',
    ]);

    const handler = messaging.subscription!.handler as (
      event: unknown,
    ) => Promise<void>;

    await handler({
      id: '00000000-0000-4000-8000-000000000001',
      type: 'ticket.created.v1',
      occurredAt: '2026-07-28T12:00:00.000Z',
      payload: {
        ticketId: TICKET,
        requesterId: REQUESTER,
        title: 'x',
        priority: 'medium',
        status: 'open',
        createdAt: '2026-07-28T12:00:00.000Z',
      },
    });
    expect(await refs.findByTicketId(TICKET)).toEqual({
      ticketId: TICKET,
      requesterId: REQUESTER,
    });

    await handler({
      id: '00000000-0000-4000-8000-000000000002',
      type: 'ticket.status-changed.v1',
      occurredAt: '2026-07-28T12:01:00.000Z',
      payload: {
        ticketId: TICKET,
        actorId: AGENT,
        fromStatus: 'open',
        toStatus: 'in_progress',
        changedAt: '2026-07-28T12:01:00.000Z',
      },
    });
    expect(notifications.notifications).toHaveLength(1);
    expect(notifications.notifications[0].userId).toBe(REQUESTER);
  });
});
