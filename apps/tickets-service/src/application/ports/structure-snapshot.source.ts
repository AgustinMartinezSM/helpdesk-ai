export const STRUCTURE_SNAPSHOT_SOURCE = Symbol('STRUCTURE_SNAPSHOT_SOURCE');

export interface SnapshotPage<T> {
  readonly items: T[];
  readonly nextCursor: string | null;
}

export interface BranchSnapshot {
  readonly branchId: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly updatedAt: Date;
}

export interface StationSnapshot {
  readonly stationId: string;
  readonly branchId: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly area: string | null;
  readonly status: string;
  readonly updatedAt: Date;
}

export interface TeamSnapshot {
  readonly teamId: string;
  readonly organizationId: string;
  readonly name: string;
  readonly status: string;
  /** EMPTY MEANS ORGANIZATION-WIDE, exactly as in the event (ADR 0022). */
  readonly branchIds: string[];
  readonly updatedAt: Date;
}

/**
 * Where a cold or drifted projection is rebuilt from (Sprint 9.16).
 *
 * The authoritative service, over HTTP, never its database — ADR 0003 forbids
 * reaching into a peer's schema, and the owner is the only thing that can
 * answer authoritatively about its own rows.
 *
 * A port rather than a direct fetch so the reconciliation use case can be
 * tested without a network, and so the one place that knows the wire format
 * stays the adapter.
 */
export interface StructureSnapshotSource {
  branches(after: string | null): Promise<SnapshotPage<BranchSnapshot>>;
  stations(after: string | null): Promise<SnapshotPage<StationSnapshot>>;
  teams(after: string | null): Promise<SnapshotPage<TeamSnapshot>>;
}
