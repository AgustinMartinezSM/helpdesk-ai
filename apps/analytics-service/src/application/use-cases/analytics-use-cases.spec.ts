import {
  NoOrganizationContextError,
  PERMISSIONS,
  type Actor,
} from '@helpdesk-ai/security';
import { ForbiddenAnalyticsActionError } from '../../domain/errors';
import {
  FixedClock,
  InMemoryTicketSnapshotRepository,
  InMemoryUserSnapshotRepository,
} from '../testing/fakes';
import {
  ApplyMembershipCreatedUseCase,
  ApplyTicketCreatedUseCase,
  ApplyTicketStatusChangedUseCase,
} from './apply-events';
import { GetAnalyticsSummaryUseCase } from './get-summary';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const ADMIN: Actor = {
  id: '44444444-4444-4444-8444-444444444444',
  organizationId: ORG_A,
  permissions: new Set([PERMISSIONS.ANALYTICS_READ]),
};
const ADMIN_B: Actor = {
  id: '55555555-5555-4555-8555-555555555555',
  organizationId: ORG_B,
  permissions: new Set([PERMISSIONS.ANALYTICS_READ]),
};
/** Right permission, no tenant: the state between registering and joining. */
const TENANTLESS_ADMIN: Actor = {
  id: '66666666-6666-4666-8666-666666666666',
  permissions: new Set([PERMISSIONS.ANALYTICS_READ]),
};
/** Agent-shaped grants: real workspace keys, none of them analytics.read. */
const AGENT: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  organizationId: ORG_A,
  permissions: new Set([
    PERMISSIONS.TICKETS_READ_ALL,
    PERMISSIONS.TICKETS_NOTE_INTERNAL,
  ]),
};
const USER: Actor = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: ORG_A,
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
    applyMembership: new ApplyMembershipCreatedUseCase(users),
    summary: new GetAnalyticsSummaryUseCase(tickets, users, clock),
  };
}

describe('ticket snapshot projection', () => {
  it('applies created then status changes, tracking resolvedAt through reopen', async () => {
    const ctx = buildContext();

    await ctx.applyCreated.execute({
      ticketId: TICKET,
      organizationId: ORG_A,
      status: 'open',
      priority: 'high',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    await ctx.applyStatus.execute({
      ticketId: TICKET,
      organizationId: ORG_A,
      toStatus: 'resolved',
      changedAt: new Date('2026-07-28T13:00:00.000Z'),
      occurredAt: new Date('2026-07-28T13:00:00.100Z'),
    });

    let snapshot = ctx.tickets.snapshots.get(TICKET);
    expect(snapshot?.status).toBe('resolved');
    expect(snapshot?.resolvedAt).toEqual(new Date('2026-07-28T13:00:00.000Z'));
    expect(snapshot?.organizationId).toBe(ORG_A);

    await ctx.applyStatus.execute({
      ticketId: TICKET,
      organizationId: ORG_A,
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
      organizationId: ORG_A,
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-28T12:05:00.000Z'),
      occurredAt: new Date('2026-07-28T12:05:00.100Z'),
    });
    expect(ctx.tickets.snapshots.get(TICKET)?.priority).toBeNull();

    // The late created backfills metadata WITHOUT regressing status.
    await ctx.applyCreated.execute({
      ticketId: TICKET,
      organizationId: ORG_A,
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
      organizationId: ORG_A,
      status: 'open',
      priority: 'low',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    const newer = {
      ticketId: TICKET,
      organizationId: ORG_A,
      toStatus: 'resolved',
      changedAt: new Date('2026-07-28T13:00:00.000Z'),
      occurredAt: new Date('2026-07-28T13:00:00.100Z'),
    };
    await ctx.applyStatus.execute(newer);

    // A stale event replayed later (e.g. DLQ replay) must not regress.
    await ctx.applyStatus.execute({
      ticketId: TICKET,
      organizationId: ORG_A,
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
  it('counts one person in BOTH organizations they belong to', async () => {
    /**
     * The defect Sprint 10.7 exists to close, at the level where it is
     * cheapest to see.
     *
     * Written RED, and it fails here for the opposite reason it fails in the
     * integration suite: the in-memory double unconditionally overwrites the
     * tenant, so the second membership MOVES the person and the first
     * organization drops to zero. Prisma refuses the second membership
     * instead, so the second organization stays at zero there. That asymmetry
     * is the divergence this sprint closes, and it is why both tests exist.
     */
    const ctx = buildContext();

    await ctx.applyMembership.execute({
      userId: USER.id,
      organizationId: ORG_A,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    await ctx.applyMembership.execute({
      userId: USER.id,
      organizationId: ORG_B,
      createdAt: new Date('2026-07-29T12:00:00.000Z'),
    });

    expect(await ctx.users.total(ORG_A)).toBe(1);
    expect(await ctx.users.total(ORG_B)).toBe(1);
  });

  it('is a no-op on redelivery, and never rewrites joinedAt', async () => {
    // At-least-once delivery, unchanged: ON CONFLICT DO NOTHING on the
    // composite key. Rewriting joinedAt would churn a row to no end — it is
    // the only non-key column and nothing reads it.
    const ctx = buildContext();
    const input = {
      userId: USER.id,
      organizationId: ORG_A,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    };

    await ctx.applyMembership.execute(input);
    await ctx.applyMembership.execute({
      ...input,
      createdAt: new Date('2026-08-01T09:00:00.000Z'),
    });

    expect(ctx.users.users.size).toBe(1);
    expect(await ctx.users.total(ORG_A)).toBe(1);
    expect([...ctx.users.users.values()][0].joinedAt).toEqual(
      new Date('2026-07-28T12:00:00.000Z'),
    );
  });

  it('records when they joined THAT organization, per row', async () => {
    // The rename is the point: while one row stood for one person the column
    // could hold a registration instant, and once a person has several rows
    // it cannot — each is a different join.
    const ctx = buildContext();

    await ctx.applyMembership.execute({
      userId: USER.id,
      organizationId: ORG_A,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });
    await ctx.applyMembership.execute({
      userId: USER.id,
      organizationId: ORG_B,
      createdAt: new Date('2026-07-29T12:00:00.000Z'),
    });

    const rows = [...ctx.users.users.values()];
    expect(rows.find((row) => row.organizationId === ORG_A)?.joinedAt).toEqual(
      new Date('2026-07-28T12:00:00.000Z'),
    );
    expect(rows.find((row) => row.organizationId === ORG_B)?.joinedAt).toEqual(
      new Date('2026-07-29T12:00:00.000Z'),
    );
  });

  it('counts nobody in an organization the person never joined', async () => {
    const ctx = buildContext();
    await ctx.applyMembership.execute({
      userId: USER.id,
      organizationId: ORG_A,
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
    });

    expect(await ctx.users.total(ORG_B)).toBe(0);
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

  it('refuses an actor whose token carries no organization', async () => {
    // The filter maps this to 403: authenticated, entitled to nothing yet.
    const ctx = buildContext();
    await expect(ctx.summary.execute(TENANTLESS_ADMIN)).rejects.toBeInstanceOf(
      NoOrganizationContextError,
    );
  });

  it('aggregates totals, groupings and a zero-filled 7-day window', async () => {
    const ctx = buildContext();
    await ctx.applyCreated.execute({
      ticketId: TICKET,
      organizationId: ORG_A,
      status: 'open',
      priority: 'high',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    await ctx.applyStatus.execute({
      ticketId: '00000000-0000-4000-8000-000000000009',
      organizationId: ORG_A,
      toStatus: 'in_progress',
      changedAt: new Date('2026-07-26T09:00:00.000Z'),
      occurredAt: new Date('2026-07-26T09:00:00.100Z'),
    });
    await ctx.applyMembership.execute({
      userId: USER.id,
      organizationId: ORG_A,
      createdAt: new Date('2026-07-27T12:00:01.000Z'),
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

  it('isolates the two organizations across all five aggregates', async () => {
    // The foreign tenant's rows use buckets that exist ONLY there ('closed',
    // 'urgent', 2026-07-25), so a leak shows up as an alien key or day —
    // by identity, not as an off-by-one in some count.
    const ctx = buildContext();

    // Organization A: one open/high ticket created on the 28th, one member.
    await ctx.applyCreated.execute({
      ticketId: TICKET,
      organizationId: ORG_A,
      status: 'open',
      priority: 'high',
      createdAt: new Date('2026-07-28T12:00:00.000Z'),
      occurredAt: new Date('2026-07-28T12:00:00.100Z'),
    });
    await ctx.applyMembership.execute({
      userId: USER.id,
      organizationId: ORG_A,
      createdAt: new Date('2026-07-27T12:00:00.000Z'),
    });

    // Organization B: two closed/urgent tickets created on the 25th, two members.
    for (const [ticketId, userId] of [
      [
        '99999999-9999-4999-8999-999999999991',
        '99999999-9999-4999-8999-999999999901',
      ],
      [
        '99999999-9999-4999-8999-999999999992',
        '99999999-9999-4999-8999-999999999902',
      ],
    ]) {
      await ctx.applyCreated.execute({
        ticketId,
        organizationId: ORG_B,
        status: 'closed',
        priority: 'urgent',
        createdAt: new Date('2026-07-25T12:00:00.000Z'),
        occurredAt: new Date('2026-07-25T12:00:00.100Z'),
      });
      await ctx.applyMembership.execute({
        userId,
        organizationId: ORG_B,
        createdAt: new Date('2026-07-25T12:00:00.000Z'),
      });
    }

    const summaryA = await ctx.summary.execute(ADMIN);
    expect(summaryA.totalTickets).toBe(1);
    expect(summaryA.byStatus).toEqual({ open: 1 });
    expect(summaryA.byPriority).toEqual({ high: 1 });
    expect(summaryA.totalUsers).toBe(1);
    expect(summaryA.createdLast7Days).toContainEqual({
      day: '2026-07-25',
      count: 0,
    });
    expect(summaryA.createdLast7Days).toContainEqual({
      day: '2026-07-28',
      count: 1,
    });

    const summaryB = await ctx.summary.execute(ADMIN_B);
    expect(summaryB.totalTickets).toBe(2);
    expect(summaryB.byStatus).toEqual({ closed: 2 });
    expect(summaryB.byPriority).toEqual({ urgent: 2 });
    expect(summaryB.totalUsers).toBe(2);
    expect(summaryB.createdLast7Days).toContainEqual({
      day: '2026-07-25',
      count: 2,
    });
    expect(summaryB.createdLast7Days).toContainEqual({
      day: '2026-07-28',
      count: 0,
    });
  });
});
