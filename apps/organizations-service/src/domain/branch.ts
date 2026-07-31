/**
 * The organizational structure ADR 0016 designed: branches are scopes
 * (authorization inputs, sitting next to memberships), departments are
 * inert grouping until routing keys on them, and operational stations are
 * context — a registered place, never a principal.
 */

/**
 * `archived` is reversible via a plain update — deliberately unlike
 * membership deactivation, which is terminal. A place is not an access
 * grant: un-archiving a store restores a name tickets can point at, while
 * reactivating a member silently restores access. The stakes differ, so the
 * lifecycles do too.
 */
export const BRANCH_STATUSES = ['active', 'archived'] as const;
export type BranchStatus = (typeof BRANCH_STATUSES)[number];

export const DEPARTMENT_STATUSES = ['active', 'archived'] as const;
export type DepartmentStatus = (typeof DEPARTMENT_STATUSES)[number];

export const STATION_STATUSES = ['active', 'archived'] as const;
export type StationStatus = (typeof STATION_STATUSES)[number];

export interface Branch {
  readonly id: string;
  readonly organizationId: string;
  /** Stable operator-facing key, unique per organization, immutable. */
  readonly code: string;
  readonly name: string;
  readonly status: BranchStatus;
  /** IANA zone name; null for the organization that never set one. */
  readonly timezone: string | null;
  readonly address: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Departments and stations carry their organizationId even though the table
 * derives it through the branch: every read of them is tenant-scoped, and a
 * denormalized field the repository joins in is safer than trusting each
 * caller to thread the tenant alongside the row.
 */
export interface Department {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  readonly name: string;
  readonly status: DepartmentStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface OperationalStation {
  readonly id: string;
  readonly organizationId: string;
  readonly branchId: string;
  /** Stable operator-facing key, unique per branch, immutable. */
  readonly code: string;
  readonly name: string;
  readonly area: string | null;
  /** Who answers for the place — not who acts as it (ADR 0017). */
  readonly responsibleMembershipId: string | null;
  readonly status: StationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Membership × branch edge. No scope qualifier column (Sprint 9.5, D3): the
 * membership's role template carries the meaning of the edge.
 */
export interface BranchMembership {
  readonly membershipId: string;
  readonly branchId: string;
  readonly createdAt: Date;
}
