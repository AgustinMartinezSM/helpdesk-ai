import { MissingTenantContextError } from '@helpdesk-ai/messaging';
import type {
  EventContract,
  EventSubscription,
  MessagingClient,
} from '@helpdesk-ai/messaging';
import {
  ApplyMembershipCreatedUseCase,
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
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function buildConsumer() {
  const messaging = new CapturingMessagingClient();
  const tickets = new InMemoryTicketSnapshotRepository();
  const users = new InMemoryUserSnapshotRepository();
  const consumer = new MetricsConsumer(
    messaging as unknown as MessagingClient,
    new ApplyTicketCreatedUseCase(tickets),
    new ApplyTicketStatusChangedUseCase(tickets),
    new ApplyUserRegisteredUseCase(users),
    new ApplyMembershipCreatedUseCase(users),
  );
  return { messaging, tickets, users, consumer };
}

async function startedHandler(ctx: ReturnType<typeof buildConsumer>) {
  await ctx.consumer.start();
  return ctx.messaging.subscription!.handler as (
    event: unknown,
  ) => Promise<void>;
}

describe('MetricsConsumer', () => {
  it('subscribes serialized (prefetch 1) with the v1 contracts still bound and the v2 stream added', async () => {
    const ctx = buildConsumer();
    await ctx.consumer.start();

    expect(ctx.messaging.subscription?.queue).toBe(METRICS_QUEUE);
    expect(ctx.messaging.subscription?.prefetch).toBe(1);
    // Pinned in order: the v1 contracts stay listed because the durable
    // queue's bindings cannot be removed by the client — they are consumed
    // as no-ops until phase 8 cleans them up with queue surgery.
    expect(
      ctx.messaging.subscription?.contracts.map((contract) => contract.type),
    ).toEqual([
      'ticket.created.v1',
      'ticket.created.v2',
      'ticket.status-changed.v1',
      'ticket.status-changed.v2',
      'user.registered.v1',
      'membership.created.v1',
    ]);
  });

  it('acknowledges ticket v1 events without touching the projections', async () => {
    const ctx = buildConsumer();
    const handler = await startedHandler(ctx);

    // Every v1 fact has a v2 twin since d87e187; applying both would
    // double-count the ticket under two envelope ids.
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

    expect(ctx.tickets.snapshots.size).toBe(0);
  });

  it('applies v2 ticket events under the envelope organization', async () => {
    const ctx = buildConsumer();
    const handler = await startedHandler(ctx);

    await handler({
      id: '00000000-0000-4000-8000-000000000001',
      type: 'ticket.created.v2',
      occurredAt: '2026-07-28T12:00:00.100Z',
      organizationId: ORG,
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
      type: 'ticket.status-changed.v2',
      occurredAt: '2026-07-28T13:00:00.100Z',
      organizationId: ORG,
      payload: {
        ticketId: TICKET,
        actorId: '33333333-3333-4333-8333-333333333333',
        fromStatus: 'open',
        toStatus: 'resolved',
        changedAt: '2026-07-28T13:00:00.000Z',
      },
    });

    const snapshot = ctx.tickets.snapshots.get(TICKET);
    expect(snapshot?.status).toBe('resolved');
    expect(snapshot?.priority).toBe('high');
    expect(snapshot?.organizationId).toBe(ORG);
  });

  it('rejects a tenantless v2 envelope so it dead-letters instead of projecting', async () => {
    const ctx = buildConsumer();
    const handler = await startedHandler(ctx);

    await expect(
      handler({
        id: '00000000-0000-4000-8000-000000000001',
        type: 'ticket.created.v2',
        occurredAt: '2026-07-28T12:00:00.100Z',
        payload: {
          ticketId: TICKET,
          requesterId: '11111111-1111-4111-8111-111111111111',
          title: 'x',
          priority: 'high',
          status: 'open',
          createdAt: '2026-07-28T12:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);
    await expect(
      handler({
        id: '00000000-0000-4000-8000-000000000002',
        type: 'ticket.status-changed.v2',
        occurredAt: '2026-07-28T13:00:00.100Z',
        payload: {
          ticketId: TICKET,
          actorId: '33333333-3333-4333-8333-333333333333',
          fromStatus: 'open',
          toStatus: 'resolved',
          changedAt: '2026-07-28T13:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(MissingTenantContextError);

    expect(ctx.tickets.snapshots.size).toBe(0);
  });

  it('projects registration and stamps the organization from membership.created', async () => {
    const ctx = buildConsumer();
    const handler = await startedHandler(ctx);
    const userId = '11111111-1111-4111-8111-111111111111';

    await handler({
      id: '00000000-0000-4000-8000-000000000003',
      type: 'user.registered.v1',
      occurredAt: '2026-07-28T12:00:00.000Z',
      payload: {
        userId,
        email: 'ada@example.com',
        roles: ['user'],
        registeredAt: '2026-07-28T12:00:00.000Z',
      },
    });
    await handler({
      id: '00000000-0000-4000-8000-000000000004',
      type: 'membership.created.v1',
      occurredAt: '2026-07-28T12:00:01.000Z',
      organizationId: ORG,
      payload: {
        membershipId: '22222222-2222-4222-8222-222222222222',
        organizationId: ORG,
        userId,
        roleTemplate: 'member',
        status: 'active',
        createdAt: '2026-07-28T12:00:01.000Z',
      },
    });

    const row = ctx.users.users.get(userId);
    expect(row?.organizationId).toBe(ORG);
    expect(row?.registeredAt).toEqual(new Date('2026-07-28T12:00:00.000Z'));
    expect(await ctx.users.total(ORG)).toBe(1);
  });
});
