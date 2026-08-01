/**
 * Local projection of a membership edge owned by organizations-service,
 * rebuilt from the membership.created.v1 / membership.status-changed.v1 /
 * membership.role-changed.v1 events.
 * organizations-service remains the source of truth for who belongs where;
 * this row exists so the directory can be scoped to an organization without
 * a synchronous call on every read (ADR 0014 forbids that dependency).
 */
export interface DirectoryMembership {
  /** Identifiers issued elsewhere; plain ids, never foreign keys (ADR 0003). */
  readonly organizationId: string;
  readonly userId: string;
  readonly roleTemplate: string;
  readonly status: string;
  /** Timestamp of the newest membership fact applied (the LWW watermark). */
  readonly updatedAt: Date;
}

/**
 * Role template stored when a status-change arrives for an edge this
 * projection has never seen — meaning the created event was lost (publishing
 * is best-effort, ADR 0006). 'requester' is the least-privileged template, so
 * inventing it errs downward; the operator script
 * (infrastructure/postgres/operations/backfill-directory-memberships.sh)
 * reconciles the truth from organizations-service's database.
 */
export const LOST_CREATED_ROLE_TEMPLATE = 'requester';
