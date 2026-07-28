import type { DailyCount, TicketSnapshot } from '../../domain/analytics';
import type {
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
 */

export class InMemoryTicketSnapshotRepository implements TicketSnapshotRepository {
  readonly snapshots = new Map<string, TicketSnapshot>();

  async applyCreated(input: ApplyTicketCreated): Promise<void> {
    const existing = this.snapshots.get(input.ticketId);
    if (!existing) {
      this.snapshots.set(input.ticketId, {
        ticketId: input.ticketId,
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
      lastEventAt: new Date(
        Math.max(existing.lastEventAt.getTime(), input.occurredAt.getTime()),
      ),
    });
  }

  async total(): Promise<number> {
    return this.snapshots.size;
  }

  async countByStatus(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const snapshot of this.snapshots.values()) {
      counts[snapshot.status] = (counts[snapshot.status] ?? 0) + 1;
    }
    return counts;
  }

  async countByPriority(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const snapshot of this.snapshots.values()) {
      if (snapshot.priority) {
        counts[snapshot.priority] = (counts[snapshot.priority] ?? 0) + 1;
      }
    }
    return counts;
  }

  async createdPerDaySince(from: Date): Promise<DailyCount[]> {
    const buckets = new Map<string, number>();
    for (const snapshot of this.snapshots.values()) {
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
  readonly users = new Map<string, Date>();

  async applyRegistered(input: {
    userId: string;
    registeredAt: Date;
  }): Promise<void> {
    if (!this.users.has(input.userId)) {
      this.users.set(input.userId, input.registeredAt);
    }
  }

  async total(): Promise<number> {
    return this.users.size;
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
