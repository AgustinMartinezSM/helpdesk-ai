import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import { ForbiddenAnalyticsActionError } from '../../domain/errors';
import {
  FixedClock,
  InMemoryTicketSnapshotRepository,
  InMemoryUserSnapshotRepository,
} from '../testing/fakes';
import {
  ApplyTicketCreatedUseCase,
  ApplyTicketStatusChangedUseCase,
  ApplyUserRegisteredUseCase,
} from './apply-events';
import { GetAnalyticsSummaryUseCase } from './get-summary';

const ADMIN: Actor = {
  id: '44444444-4444-4444-8444-444444444444',
  roles: ['admin'],
  permissions: new Set([PERMISSIONS.ANALYTICS_READ]),
};
/** Agent-shaped grants: real workspace keys, none of them analytics.read. */
const AGENT: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  roles: ['agent'],
  permissions: new Set([
    PERMISSIONS.TICKETS_READ_ALL,
    PERMISSIONS.TICKETS_NOTE_INTERNAL,
  ]),
};
const USER: Actor = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['user'],
  permissions: new Set([PERMISSIONS.ORGANIZATION_READ]),
};

const TICKET = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';

function buildContext() {
  const tickets = new InMemoryTicketSnapshotRepository();
  const users = new InMemoryUserSnapshotRepository();
  const clock = new FixedClock(new Date('2026-07-28T15:00:00.000Z'));
  return {
    tickets,
    users,
    clock,
    applyCreated: new ApplyTicketCreatedUseCase(tickets),
    applyStatus: new ApplyTicketStatusChangedUseCase(tickets),
    applyUser: new ApplyUserRegisteredUseCase(users),
    summary: new GetAnalyticsSummaryUseCase(tickets, users, clock),
  };
}

describe('ticket snapshot projection', () => {
  it('applies created then status changes, tracking resolvedAt through reopen', async () => {
    const ctx = buildContext();

    await ctx.applyCreated.execute({
      ticketId: TICKET,
      status: 'open',
      priority: 'high',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    await ctx.applyStatus.execute({
      ticketId: TICKET,
      toStatus: 'resolved',
      changedAt: new Date('2026-07-28T13:00:00.000Z'),
      occurredAt: new Date('2026-07-28T13:00:00.100Z'),
    });

    let snapshot = ctx.tickets.snapshots.get(TICKET);
    expect(snapshot?.status).toBe('resolved');
    expect(snapshot?.resolvedAt).toEqual(new Date('2026-07-28T13:00:00.000Z'));

    await ctx.applyStatus.execute({
      ticketId: TICKET,
      toStatus: 'open',
      changedAt: new Date('2026-07-28T14:00:00.000Z'),
      occurredAt: new Date('2026-07-28T14:00:00.100Z'),
    });

    snapshot = ctx.tickets.snapshots.get(TICKET);
    expect(snapshot?.status).toBe('open');
    expect(snapshot?.resolvedAt).toBeNull();
    expect(snapshot?.priority).toBe('high');
  });

  it('tolerates a status change arriving before created, backfilled later', async () => {
    const ctx = buildContext();

    // status-changed first: partial row with unknown priority.
    await ctx.applyStatus.execute({
      ticketId: TICKET,
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-28T12:05:00.000Z'),
      occurredAt: new Date('2026-07-28T12:05:00.100Z'),
    });
    expect(ctx.tickets.snapshots.get(TICKET)?.priority).toBeNull();

    // The late created backfills metadata WITHOUT regressing status.
    await ctx.applyCreated.execute({
      ticketId: TICKET,
      status: 'open',
      priority: 'urgent',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });

    const snapshot = ctx.tickets.snapshots.get(TICKET);
    expect(snapshot?.status).toBe('in_progress');
    expect(snapshot?.priority).toBe('urgent');
    expect(snapshot?.createdAt).toEqual(new Date('2026-07-28T12:00:00.000Z'));
  });

  it('ignores an out-of-order older status change and stays idempotent on redelivery', async () => {
    const ctx = buildContext();
    await ctx.applyCreated.execute({
      ticketId: TICKET,
      status: 'open',
      priority: 'low',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    const newer = {
      ticketId: TICKET,
      toStatus: 'resolved',
      changedAt: new Date('2026-07-28T13:00:00.000Z'),
      occurredAt: new Date('2026-07-28T13:00:00.100Z'),
    };
    await ctx.applyStatus.execute(newer);

    // A stale event replayed later (e.g. DLQ replay) must not regress.
    await ctx.applyStatus.execute({
      ticketId: TICKET,
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-28T12:30:00.000Z'),
      occurredAt: new Date('2026-07-28T12:30:00.100Z'),
    });
    expect(ctx.tickets.snapshots.get(TICKET)?.status).toBe('resolved');

    // Exact redelivery is a no-op.
    await ctx.applyStatus.execute(newer);
    expect(ctx.tickets.snapshots.get(TICKET)?.status).toBe('resolved');
    expect(ctx.tickets.snapshots.size).toBe(1);
  });
});

describe('user snapshot projection', () => {
  it('is idempotent on userId', async () => {
    const ctx = buildContext();
    const input = {
      userId: USER.id,
      registeredAt: new Date('2026-07-28T12:00:00.000Z'),
    };
    await ctx.applyUser.execute(input);
    await ctx.applyUser.execute(input);
    expect(await ctx.users.total()).toBe(1);
  });
});

describe('GetAnalyticsSummaryUseCase', () => {
  it('requires analytics.read', async () => {
    const ctx = buildContext();
    await expect(ctx.summary.execute(USER)).rejects.toBeInstanceOf(
      ForbiddenAnalyticsActionError,
    );
  });

  it('refuses agents: analytics.read is not in their template', async () => {
    // DELIBERATE behavior change pinned on purpose. The approved matrix in
    // docs/architecture/tenancy-target-state.md grants analytics.read to
    // admins, owners and auditors — not agents, who could read the summary
    // while the gate was the generic staff check. If this test starts
    // failing because agents got the key back, that is a matrix change to
    // make in the document first.
    const ctx = buildContext();
    await expect(ctx.summary.execute(AGENT)).rejects.toBeInstanceOf(
      ForbiddenAnalyticsActionError,
    );
  });

  it('aggregates totals, groupings and a zero-filled 7-day window', async () => {
    const ctx = buildContext();
    await ctx.applyCreated.execute({
      ticketId: TICKET,
      status: 'open',
      priority: 'high',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    await ctx.applyStatus.execute({
      ticketId: '00000000-0000-4000-8000-000000000009',
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-26T09:00:00.000Z'),
      occurredAt: new Date('2026-07-26T09:00:00.100Z'),
    });
    await ctx.applyUser.execute({
      userId: USER.id,
      registeredAt: new Date('2026-07-27T12:00:00.000Z'),
    });

    const summary = await ctx.summary.execute(ADMIN);

    expect(summary.totalTickets).toBe(2);
    expect(summary.byStatus).toEqual({ open: 1, in_progress: 1 });
    // The partial snapshot has unknown priority and is excluded here.
    expect(summary.byPriority).toEqual({ high: 1 });
    expect(summary.totalUsers).toBe(1);
    expect(summary.createdLast7Days).toHaveLength(7);
    expect(summary.createdLast7Days[0]).toEqual({
      day: '2026-07-22',
      count: 0,
    });
    expect(summary.createdLast7Days[6]).toEqual({
      day: '2026-07-28',
      count: 1,
    });
  });
});
