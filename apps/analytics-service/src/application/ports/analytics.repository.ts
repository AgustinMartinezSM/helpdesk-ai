import type { DailyCount } from '../../domain/analytics';

export const TICKET_SNAPSHOT_REPOSITORY = Symbol('TICKET_SNAPSHOT_REPOSITORY');

export interface ApplyTicketCreated {
  ticketId: string;
  status: string;
  priority: string;
  createdAt: Date;
  /** Envelope occurredAt — the LWW clock, uniform across event types. */
  occurredAt: Date;
}

export interface ApplyTicketStatusChanged {
  ticketId: string;
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
 */
export interface TicketSnapshotRepository {
  applyCreated(input: ApplyTicketCreated): Promise<void>;
  applyStatusChanged(input: ApplyTicketStatusChanged): Promise<void>;
  total(): Promise<number>;
  countByStatus(): Promise<Record<string, number>>;
  /** Snapshots with unknown priority are excluded. */
  countByPriority(): Promise<Record<string, number>>;
  /** Tickets created on or after `from`, bucketed per UTC day. */
  createdPerDaySince(from: Date): Promise<DailyCount[]>;
}

export const USER_SNAPSHOT_REPOSITORY = Symbol('USER_SNAPSHOT_REPOSITORY');

export interface UserSnapshotRepository {
  /** Idempotent on userId. */
  applyRegistered(input: { userId: string; registeredAt: Date }): Promise<void>;
  total(): Promise<number>;
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
