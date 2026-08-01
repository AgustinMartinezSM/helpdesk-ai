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

export interface ApplyMembershipRoleChanged {
  organizationId: string;
  userId: string;
  toTemplate: string;
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
  /**
   * Unlike applyStatusChanged, a missing row is SKIPPED, never created. The
   * status-changed placeholder invents privilege downward (requester) while
   * pinning the safety-relevant fact the event actually carries (the
   * status); a role-changed event carries no status, so a row shaped from
   * it would be a guess in both directions — upward on privilege or wrong
   * on liveness. The operator script
   * (infrastructure/postgres/operations/backfill-directory-memberships.sh)
   * is the documented reconciliation. Resolves false on that skip so the
   * caller can warn.
   */
  applyRoleChanged(input: ApplyMembershipRoleChanged): Promise<boolean>;
}
