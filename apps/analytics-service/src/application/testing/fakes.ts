import {
  COUNTED_MEMBERSHIP_STATUS,
  type DailyCount,
  type TicketSnapshot,
  type UserSnapshot,
} from '../../domain/analytics';
import type {
  ApplyMembershipCreated,
  ApplyMembershipStatusChanged,
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

  /**
   * Mirrors the SQL statement by statement, including the parts that are easy
   * to approximate: LEAST on joinedAt, GREATEST on lastEventAt, and the `<=`
   * tie-break that lets an equal timestamp win. The temptation is to write
   * "close enough" here — that is exactly what produced the defect this class
   * carries in its own comment.
   */
  async applyMembershipCreated(input: ApplyMembershipCreated): Promise<void> {
    const key = this.key(input.userId, input.organizationId);
    const existing = this.users.get(key);
    if (!existing) {
      this.users.set(key, {
        userId: input.userId,
        organizationId: input.organizationId,
        joinedAt: input.createdAt,
        status: input.status,
        lastEventAt: input.createdAt,
      });
      return;
    }
    const wins = existing.lastEventAt <= input.createdAt;
    this.users.set(key, {
      ...existing,
      // LEAST: a membership's creation time is the earliest fact about the
      // edge, so a late created event corrects a placeholder's guess downward
      // and can never move the column forward.
      joinedAt: new Date(
        Math.min(existing.joinedAt.getTime(), input.createdAt.getTime()),
      ),
      status: wins ? input.status : existing.status,
      lastEventAt: new Date(
        Math.max(existing.lastEventAt.getTime(), input.createdAt.getTime()),
      ),
    });
  }

  async applyMembershipStatusChanged(
    input: ApplyMembershipStatusChanged,
  ): Promise<void> {
    const key = this.key(input.userId, input.organizationId);
    const existing = this.users.get(key);
    if (!existing) {
      // Inserts rather than skipping — see the port contract. joinedAt takes
      // the change's own timestamp, and nothing here is ever deleted.
      this.users.set(key, {
        userId: input.userId,
        organizationId: input.organizationId,
        joinedAt: input.changedAt,
        status: input.status,
        lastEventAt: input.changedAt,
      });
      return;
    }
    const wins = existing.lastEventAt <= input.changedAt;
    this.users.set(key, {
      ...existing,
      status: wins ? input.status : existing.status,
      lastEventAt: new Date(
        Math.max(existing.lastEventAt.getTime(), input.changedAt.getTime()),
      ),
    });
  }

  async total(organizationId: string): Promise<number> {
    return [...this.users.values()].filter(
      (user) =>
        user.organizationId === organizationId &&
        user.status === COUNTED_MEMBERSHIP_STATUS,
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
