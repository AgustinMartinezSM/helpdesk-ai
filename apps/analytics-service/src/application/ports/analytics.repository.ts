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
  /** Membership creation time; becomes `joinedAt` on the row. */
  createdAt: Date;
}

/**
 * The membership edge set, projected for counting (Sprint 10.7, ADR 0026).
 *
 * There is no `applyRegistered` any more, and its absence is the decision.
 * A registration is tenantless by construction — the membership that would
 * supply a tenant is created by consuming that very event — so a row written
 * from one had no organization, and a row with no organization answers
 * nothing this projection is asked. Worse, it made the tenant first-come-wins,
 * and the first to come was always the bootstrap membership.
 */
export interface UserSnapshotRepository {
  /**
   * Records that a person belongs to an organization. One row per edge, so
   * somebody in two organizations is counted in both.
   *
   * Idempotent on `(userId, organizationId)`: redelivery inserts nothing and
   * never rewrites `joinedAt`, which is the only non-key column and which
   * nothing reads — rewriting it would churn rows to no end.
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
