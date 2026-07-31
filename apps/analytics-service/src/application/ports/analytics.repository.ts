import type { DailyCount } from '../../domain/analytics';

export const TICKET_SNAPSHOT_REPOSITORY = Symbol('TICKET_SNAPSHOT_REPOSITORY');

export interface ApplyTicketCreated {
  ticketId: string;
  /** Envelope tenant of the v2 event — the ticket's truth, LWW-applied. */
  organizationId: string;
  status: string;
  priority: string;
  createdAt: Date;
  /** Envelope occurredAt — the LWW clock, uniform across event types. */
  occurredAt: Date;
}

export interface ApplyTicketStatusChanged {
  ticketId: string;
  organizationId: string;
  toStatus: string;
  changedAt: Date;
  occurredAt: Date;
}

/**
 * Both apply operations MUST be atomic upserts with a last-writer-wins
 * guard on occurredAt: events for one ticket may arrive out of order or
 * twice, and a read-then-write here would corrupt the projection under
 * concurrency. created additionally backfills priority/createdAt on rows
 * seeded by an earlier status change, without clobbering newer status.
 * organizationId follows the LWW rule like status: a v2 event is the
 * ticket's truth and may correct a migration-backfilled value.
 *
 * Every aggregate takes a REQUIRED organizationId. All five changed in one
 * coherent step on purpose: a dashboard mixing scoped and unscoped numbers
 * would be worse than either, so there is no signature through which an
 * unscoped read can survive.
 */
export interface TicketSnapshotRepository {
  applyCreated(input: ApplyTicketCreated): Promise<void>;
  applyStatusChanged(input: ApplyTicketStatusChanged): Promise<void>;
  total(organizationId: string): Promise<number>;
  countByStatus(organizationId: string): Promise<Record<string, number>>;
  /** Snapshots with unknown priority are excluded. */
  countByPriority(organizationId: string): Promise<Record<string, number>>;
  /** Tickets created on or after `from`, bucketed per UTC day. */
  createdPerDaySince(organizationId: string, from: Date): Promise<DailyCount[]>;
}

export const USER_SNAPSHOT_REPOSITORY = Symbol('USER_SNAPSHOT_REPOSITORY');

export interface ApplyMembershipCreated {
  userId: string;
  organizationId: string;
  /** Membership creation time — becomes registeredAt on a row seeded here. */
  createdAt: Date;
}

export interface UserSnapshotRepository {
  /** Idempotent on userId; never overwrites a row that already exists. */
  applyRegistered(input: { userId: string; registeredAt: Date }): Promise<void>;
  /**
   * Atomic upsert keyed on userId: stamps the organization on an existing
   * row, or creates the row when the registration event was lost or is late
   * — a member the organization can see must never be missing from its
   * count. On the create path registeredAt is the membership time: the
   * honest nearby value, since the real registration instant never arrived.
   */
  applyMembershipCreated(input: ApplyMembershipCreated): Promise<void>;
  total(organizationId: string): Promise<number>;
}

export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
