import { MissingTenantContextError } from '@helpdesk-ai/messaging';
import type {
  EventContract,
  EventSubscription,
  MessagingClient,
} from '@helpdesk-ai/messaging';
import {
  ApplyMembershipCreatedUseCase,
  ApplyMembershipStatusChangedUseCase,
  ApplyTicketCreatedUseCase,
  ApplyTicketStatusChangedUseCase,
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
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function buildConsumer() {
  const messaging = new CapturingMessagingClient();
  const tickets = new InMemoryTicketSnapshotRepository();
  const users = new InMemoryUserSnapshotRepository();
  const consumer = new MetricsConsumer(
    messaging as unknown as MessagingClient,
    new ApplyTicketCreatedUseCase(tickets),
    new ApplyTicketStatusChangedUseCase(tickets),
    new ApplyMembershipCreatedUseCase(users),
    new ApplyMembershipStatusChangedUseCase(users),
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
  it('subscribes serialized (prefetch 1) to the v2 stream, retiring the v1 binding keys', async () => {
    const ctx = buildConsumer();
    await ctx.consumer.start();

    expect(ctx.messaging.subscription?.queue).toBe(METRICS_QUEUE);
    expect(ctx.messaging.subscription?.prefetch).toBe(1);
    // Pinned in order: dropping a contract here would silently stop
    // projecting its stream. The v1 contracts are gone — deleted in
    // phase 8, not consumed as no-ops any more.
    expect(
      ctx.messaging.subscription?.contracts.map((contract) => contract.type),
    ).toEqual([
      'ticket.created.v2',
      'ticket.status-changed.v2',
      'membership.created.v1',
      // Sprint 10.8: the first membership fact besides joining that this
      // projection has ever heard, and the only reason the count can fall.
      'membership.status-changed.v1',
    ]);
    // Pinned too: dropping a retired key before every environment's durable
    // queue has booted past this version would leave a stale binding
    // delivering events that now dead-letter as "no contract bound".
    expect(ctx.messaging.subscription?.retiredBindingKeys).toEqual([
      'ticket.created.v1',
      'ticket.status-changed.v1',
      // Sprint 10.7, and the only entry here that is NOT a deleted contract:
      // auth-service still publishes registrations and three other consumers
      // still want them. Only THIS queue stopped caring. Leaving it bound
      // after the NOT NULL migration would dead-letter every registration.
      'user.registered.v1',
    ]);
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

  const userId = '11111111-1111-4111-8111-111111111111';

  function membershipEvent(organizationId: string, id: string, at: string) {
    return {
      id,
      type: 'membership.created.v1',
      occurredAt: at,
      organizationId,
      payload: {
        membershipId: '22222222-2222-4222-8222-222222222222',
        organizationId,
        userId,
        roleTemplate: 'member',
        status: 'active',
        createdAt: at,
      },
    };
  }

  it('counts one person in every organization they join', async () => {
    const ctx = buildConsumer();
    const handler = await startedHandler(ctx);

    await handler(
      membershipEvent(
        ORG,
        '00000000-0000-4000-8000-000000000004',
        '2026-07-28T12:00:01.000Z',
      ),
    );
    await handler(
      membershipEvent(
        ORG_B,
        '00000000-0000-4000-8000-000000000005',
        '2026-07-29T12:00:01.000Z',
      ),
    );

    expect(await ctx.users.total(ORG)).toBe(1);
    expect(await ctx.users.total(ORG_B)).toBe(1);
  });

  it('does nothing at all with a registration', async () => {
    // The binding is retired, so in production this event never reaches the
    // handler. Asserting the arm is gone too is what stops somebody
    // re-adding one that would write a row with no organization — which the
    // NOT NULL column would refuse, dead-lettering every registration.
    const ctx = buildConsumer();
    const handler = await startedHandler(ctx);

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

    expect(ctx.users.users.size).toBe(0);
  });
});
