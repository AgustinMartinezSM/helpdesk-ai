import type { AuditEvent } from '../../domain/audit-event';

export const AUDIT_EVENT_REPOSITORY = Symbol('AUDIT_EVENT_REPOSITORY');

export interface AuditEventListFilter {
  /**
   * Tenant scope, required and first on purpose: a field the compiler
   * insists on cannot be forgotten quietly, and forgetting it is exactly how
   * a read would leak the whole trail.
   */
  organizationId: string;
  type?: string;
  limit: number;
  offset: number;
}

/**
 * Append-only by contract: there is deliberately no update or delete.
 * `record` must be idempotent on the event id (at-least-once delivery).
 */
export interface AuditEventRepository {
  record(event: AuditEvent): Promise<void>;
  /** Newest first by occurredAt. */
  list(filter: AuditEventListFilter): Promise<AuditEvent[]>;
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
