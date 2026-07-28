/**
 * One recorded domain event, exactly as it crossed the bus. The trail is
 * append-only: nothing in this service mutates or deletes a record. The id
 * is the event envelope id, so redelivery collapses into the same row.
 *
 * The payload is opaque on purpose (schema-on-read): audit must capture
 * event types it has no contract for, including future versions.
 */
export interface AuditEvent {
  readonly id: string;
  readonly type: string;
  readonly occurredAt: Date;
  readonly correlationId: string | null;
  readonly payload: unknown;
  readonly recordedAt: Date;
}
