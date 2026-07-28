import type { AuditEvent } from '../../domain/audit-event';
import type {
  AuditEventListFilter,
  AuditEventRepository,
  Clock,
} from '../ports/audit-event.repository';

/** Deterministic in-memory test doubles for the application layer. */

export class InMemoryAuditEventRepository implements AuditEventRepository {
  readonly events = new Map<string, AuditEvent>();

  async record(event: AuditEvent): Promise<void> {
    // Mirrors INSERT ... ON CONFLICT DO NOTHING: first write wins.
    if (!this.events.has(event.id)) {
      this.events.set(event.id, event);
    }
  }

  async list(filter: AuditEventListFilter): Promise<AuditEvent[]> {
    return [...this.events.values()]
      .filter((event) => !filter.type || event.type === filter.type)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(filter.offset, filter.offset + filter.limit);
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
