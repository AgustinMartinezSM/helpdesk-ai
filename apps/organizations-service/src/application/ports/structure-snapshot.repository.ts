export const STRUCTURE_SNAPSHOT_REPOSITORY = Symbol(
  'STRUCTURE_SNAPSHOT_REPOSITORY',
);

/**
 * One page of a snapshot. `nextCursor` is the last id on the page, or null
 * when the page is the last one — keyset pagination rather than offset, so a
 * row inserted mid-run cannot make the reader skip or repeat one.
 */
export interface SnapshotPage<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

/** Exactly the fields `branch_refs` holds, plus the LWW key. */
export interface BranchSnapshotRow {
  readonly branchId: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly updatedAt: Date;
}

export interface StationSnapshotRow {
  readonly stationId: string;
  readonly branchId: string;
  /** Derived through the branch: a station has no column of its own. */
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly area: string | null;
  readonly status: string;
  readonly updatedAt: Date;
}

export interface TeamSnapshotRow {
  readonly teamId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: string;
  /**
   * The team's branch reach, INLINE. An EMPTY ARRAY MEANS ORGANIZATION-WIDE
   * (ADR 0022) and travels as one, exactly as the scope event does.
   *
   * Inline rather than a second call because the scope is a set: fetching it
   * separately would leave a window where a consumer had the team with the
   * wrong reach, which is the one drift that hides work from the people who
   * should get it.
   */
  readonly branchIds: string[];
  readonly updatedAt: Date;
}

/**
 * The read side of the projection snapshot (Sprint 9.16).
 *
 * **This is the one repository in this service that is deliberately NOT
 * organization-scoped, and it needs its reason stated.** Every other port here
 * requires an `organizationId` so that a foreign row and a nonexistent one are
 * indistinguishable at the boundary — a property Sprint 9.12 wrote down for
 * support teams and every structure port follows. Do not weaken those.
 *
 * This one is global because its caller cannot be scoped: a peer service
 * rebuilding a cold projection has to learn about organizations it has never
 * seen, and an organization with branches but no tickets yet is exactly the
 * cold-start case. The tenant safety comes from a different place instead —
 * every row STATES its own organization, and the consumer writes that value,
 * so a global read cannot produce a row belonging to the wrong tenant.
 *
 * It is reachable only through `/internal/*` behind `InternalServiceGuard`,
 * which the api-gateway does not route and whose header the gateway strips
 * from every inbound request. No person-facing surface may ever call this.
 */
export interface StructureSnapshotRepository {
  branches(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<BranchSnapshotRow>>;
  stations(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<StationSnapshotRow>>;
  teams(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<TeamSnapshotRow>>;
}
