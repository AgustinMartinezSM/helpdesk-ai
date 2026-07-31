import type {
  FirehoseSubscription,
  MessagingClient,
} from '@helpdesk-ai/messaging';
import { RecordAuditEventUseCase } from '../../application/use-cases/record-audit-event';
import {
  FixedClock,
  InMemoryAuditEventRepository,
} from '../../application/testing/fakes';
import { EVENT_LOG_QUEUE, EventLogConsumer } from './event-log.consumer';

class CapturingMessagingClient {
  subscription?: FirehoseSubscription;
  closed = false;

  async subscribeFirehose(subscription: FirehoseSubscription): Promise<void> {
    this.subscription = subscription;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

describe('EventLogConsumer', () => {
  it('subscribes the firehose queue to every routing key and records deliveries', async () => {
    const messaging = new CapturingMessagingClient();
    const events = new InMemoryAuditEventRepository();
    const consumer = new EventLogConsumer(
      messaging as unknown as MessagingClient,
      new RecordAuditEventUseCase(
        events,
        new FixedClock(new Date('2026-07-28T12:00:05.000Z')),
      ),
    );

    await consumer.start();

    expect(messaging.subscription?.queue).toBe(EVENT_LOG_QUEUE);
    expect(messaging.subscription?.patterns).toEqual(['#']);

    await messaging.subscription?.handler({
      id: '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f',
      type: 'some.future.event.v9',
      occurredAt: '2026-07-28T12:00:00.000Z',
      // v9 is tenant-carrying (v2 or higher), so the envelope brings one.
      organizationId: '00000000-0000-4000-8000-000000000001',
      payload: { opaque: true },
    });

    const recorded = events.events.get('7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f');
    expect(recorded?.type).toBe('some.future.event.v9');
    expect(recorded?.organizationId).toBe(
      '00000000-0000-4000-8000-000000000001',
    );
  });

  it('closes its messaging client on shutdown', async () => {
    const messaging = new CapturingMessagingClient();
    const consumer = new EventLogConsumer(
      messaging as unknown as MessagingClient,
      new RecordAuditEventUseCase(
        new InMemoryAuditEventRepository(),
        new FixedClock(new Date()),
      ),
    );

    await consumer.onApplicationShutdown();
    expect(messaging.closed).toBe(true);
  });
});
