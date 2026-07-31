export const MEMBERSHIP_PROJECTION_REPOSITORY = Symbol(
  'MEMBERSHIP_PROJECTION_REPOSITORY',
);

export interface ApplyMembershipCreated {
  organizationId: string;
  userId: string;
  roleTemplate: string;
  status: string;
  /** The payload's own timestamp (createdAt); becomes the row's updated_at. */
  occurredAt: Date;
}

export interface ApplyMembershipStatusChanged {
  organizationId: string;
  userId: string;
  toStatus: string;
  /** The payload's own timestamp (changedAt); becomes the row's updated_at. */
  occurredAt: Date;
}

/**
 * Write side of the directory's membership projection. Both applies are
 * last-writer-wins upserts keyed on (organizationId, userId): an event is
 * applied only if its timestamp is >= the stored updated_at, so a replayed
 * stale event (e.g. a DLQ replay) can never regress a newer status. Ties
 * resolve to the later arrival on purpose — with the per-queue serialized
 * consumer that is publication order (same reasoning as analytics-service's
 * snapshot repository).
 */
export interface MembershipProjectionRepository {
  applyCreated(input: ApplyMembershipCreated): Promise<void>;
  /**
   * On a missing row this still creates one, with the role template set to
   * LOST_CREATED_ROLE_TEMPLATE: a status-change for an unknown edge means
   * the created event was lost, and the operator script reconciles the
   * truth later.
   */
  applyStatusChanged(input: ApplyMembershipStatusChanged): Promise<void>;
}
