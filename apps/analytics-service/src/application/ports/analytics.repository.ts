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
  /** Status the membership was created with; the platform always says 'active'. */
  status: string;
  /**
   * Membership creation time. Becomes `joinedAt` on insert, and is the LWW
   * clock for this event — the payload's own timestamp, matching what
   * users-service's directory projection uses for the same three contracts.
   */
  createdAt: Date;
}

export interface ApplyMembershipStatusChanged {
  userId: string;
  organizationId: string;
  /** The post-transition status; `toStatus` on the wire. */
  status: string;
  /** The payload's own timestamp; the LWW clock for this event. */
  changedAt: Date;
}

/**
 * The membership edge set, projected for counting (Sprint 10.7, ADR 0026;
 * status added in 10.8).
 *
 * There is no `applyRegistered` any more, and its absence is the decision.
 * A registration is tenantless by construction — the membership that would
 * supply a tenant is created by consuming that very event — so a row written
 * from one had no organization, and a row with no organization answers
 * nothing this projection is asked. Worse, it made the tenant first-come-wins,
 * and the first to come was always the bootstrap membership.
 *
 * BOTH applies are last-writer-wins upserts guarded on `lastEventAt`, and
 * NEITHER ever deletes. Deleting on `deactivated` looks tidier and is wrong
 * three ways: that status stopped being terminal in Sprint 9.10, so the delete
 * would have to be undone by an insert whose `joinedAt` nobody has any more; it
 * discards the watermark, so a stale replay would remove a row that should
 * exist; and it destroys the evidence that explains the number.
 */
export interface UserSnapshotRepository {
  /**
   * Records that a person belongs to an organization. One row per edge, so
   * somebody in two organizations is counted in both.
   *
   * Insert is idempotent on `(userId, organizationId)`, and `joinedAt` is
   * never rewritten — rewriting it would churn rows to no end. On an existing
   * row it behaves as the guard says: a created event OLDER than the stored
   * watermark changes nothing, which is what stops ordinary out-of-order
   * delivery from reviving somebody who was suspended after joining.
   */
  applyMembershipCreated(input: ApplyMembershipCreated): Promise<void>;
  /**
   * Applies a status transition under the same guard.
   *
   * On an edge this projection has never seen it CREATES the row, with
   * `joinedAt` set to the change's own timestamp. users-service settled the
   * same asymmetry for the same events: a lost created event must not make a
   * live person invisible, and the operator script reconciles the truth. This
   * projection has the easier half of it — it stores no role template, so the
   * placeholder invents nothing, it only records what the event says.
   */
  applyMembershipStatusChanged(
    input: ApplyMembershipStatusChanged,
  ): Promise<void>;
  /**
   * Active members of one organization.
   *
   * `status = 'active'` rather than "not suspended and not deactivated": the
   * membership contracts type status as a free string so the vocabulary can
   * move without a breaking change, and naming what counts means an unknown
   * status is not counted rather than counted by accident.
   */
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
