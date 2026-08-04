import type {
  DailyCount,
  TicketSnapshot,
  UserSnapshot,
} from '../../domain/analytics';
import type {
  ApplyMembershipCreated,
  ApplyTicketCreated,
  ApplyTicketStatusChanged,
  Clock,
  TicketSnapshotRepository,
  UserSnapshotRepository,
} from '../ports/analytics.repository';

/**
 * Deterministic in-memory test doubles. The snapshot fake mirrors the SQL
 * semantics exactly (LWW guard with <=, COALESCE backfill) so use-case
 * specs exercise the same rules the real repository enforces atomically.
 * Every aggregate filters by organizationId the way the real WHERE clauses
 * do — deliberately, so a unit suite cannot pass against a read that leaks
 * another tenant's rows.
 */

export class InMemoryTicketSnapshotRepository implements TicketSnapshotRepository {
  readonly snapshots = new Map<string, TicketSnapshot>();

  async applyCreated(input: ApplyTicketCreated): Promise<void> {
    const existing = this.snapshots.get(input.ticketId);
    if (!existing) {
      this.snapshots.set(input.ticketId, {
        ticketId: input.ticketId,
        organizationId: input.organizationId,
        status: input.status,
        priority: input.priority,
        createdAt: input.createdAt,
        resolvedAt: null,
        lastEventAt: input.occurredAt,
      });
      return;
    }
    const wins = existing.lastEventAt <= input.occurredAt;
    this.snapshots.set(input.ticketId, {
      ...existing,
      priority: existing.priority ?? input.priority,
      createdAt: existing.createdAt ?? input.createdAt,
      status: wins ? input.status : existing.status,
      resolvedAt: wins ? null : existing.resolvedAt,
      // Like status, not like priority: a newer event may correct the tenant.
      organizationId: wins ? input.organizationId : existing.organizationId,
      lastEventAt: new Date(
        Math.max(existing.lastEventAt.getTime(), input.occurredAt.getTime()),
      ),
    });
  }

  async applyStatusChanged(input: ApplyTicketStatusChanged): Promise<void> {
    const resolvedAt = input.toStatus === 'resolved' ? input.changedAt : null;
    const existing = this.snapshots.get(input.ticketId);
    if (!existing) {
      this.snapshots.set(input.ticketId, {
        ticketId: input.ticketId,
        organizationId: input.organizationId,
        status: input.toStatus,
        priority: null,
        createdAt: null,
        resolvedAt,
        lastEventAt: input.occurredAt,
      });
      return;
    }
    const wins = existing.lastEventAt <= input.occurredAt;
    this.snapshots.set(input.ticketId, {
      ...existing,
      status: wins ? input.toStatus : existing.status,
      resolvedAt: wins ? resolvedAt : existing.resolvedAt,
      organizationId: wins ? input.organizationId : existing.organizationId,
      lastEventAt: new Date(
        Math.max(existing.lastEventAt.getTime(), input.occurredAt.getTime()),
      ),
    });
  }

  private scoped(organizationId: string): TicketSnapshot[] {
    return [...this.snapshots.values()].filter(
      (snapshot) => snapshot.organizationId === organizationId,
    );
  }

  async total(organizationId: string): Promise<number> {
    return this.scoped(organizationId).length;
  }

  async countByStatus(organizationId: string): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const snapshot of this.scoped(organizationId)) {
      counts[snapshot.status] = (counts[snapshot.status] ?? 0) + 1;
    }
    return counts;
  }

  async countByPriority(
    organizationId: string,
  ): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const snapshot of this.scoped(organizationId)) {
      if (snapshot.priority) {
        counts[snapshot.priority] = (counts[snapshot.priority] ?? 0) + 1;
      }
    }
    return counts;
  }

  async createdPerDaySince(
    organizationId: string,
    from: Date,
  ): Promise<DailyCount[]> {
    const buckets = new Map<string, number>();
    for (const snapshot of this.scoped(organizationId)) {
      if (snapshot.createdAt && snapshot.createdAt >= from) {
        const day = snapshot.createdAt.toISOString().slice(0, 10);
        buckets.set(day, (buckets.get(day) ?? 0) + 1);
      }
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day, count }));
  }
}

export class InMemoryUserSnapshotRepository implements UserSnapshotRepository {
  /**
   * Keyed on the EDGE, exactly as the table is since Sprint 10.7.
   *
   * The previous version of this double was keyed on userId and
   * unconditionally overwrote the tenant — while Prisma refused to move a
   * stamped row at all. So the two disagreed about the very behaviour the
   * repository's comment said must never happen, and nothing pinned either.
   * That is the R2 lesson for the third time (R2, then 9.12's team predicate,
   * now this): a double more permissive than the database certifies semantics
   * production does not produce.
   */
  readonly users = new Map<string, UserSnapshot>();

  private key(userId: string, organizationId: string): string {
    return `${userId}:${organizationId}`;
  }

  async applyMembershipCreated(input: ApplyMembershipCreated): Promise<void> {
    // Mirrors ON CONFLICT DO NOTHING on the composite key: a redelivery
    // changes nothing, including joinedAt.
    const key = this.key(input.userId, input.organizationId);
    if (this.users.has(key)) {
      return;
    }
    this.users.set(key, {
      userId: input.userId,
      organizationId: input.organizationId,
      joinedAt: input.createdAt,
    });
  }

  async total(organizationId: string): Promise<number> {
    return [...this.users.values()].filter(
      (user) => user.organizationId === organizationId,
    ).length;
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
