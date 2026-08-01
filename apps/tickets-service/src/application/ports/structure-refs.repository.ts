export const BRANCH_REF_REPOSITORY = Symbol('BRANCH_REF_REPOSITORY');
export const STATION_REF_REPOSITORY = Symbol('STATION_REF_REPOSITORY');

/**
 * The one status value the projection keys on. The vocabulary is
 * deliberately unfrozen strings end to end (see the contract's comment) —
 * this constant only pins the single word the reads filter by, so a rename
 * in organizations-service is one edit here, not a schema change.
 */
export const ACTIVE_REF_STATUS = 'active';

/**
 * Local projections of organizations-service's structure (D4). Ticket
 * creation is a hot path, so branch/station validation reads these rows —
 * fed by the branch.*\/station.* events — instead of asking the owning
 * service synchronously; ADR 0014's mutations-may-ask exception deliberately
 * does not apply. These are read models, not domain entities: nothing here
 * has behavior, so the shapes live with the port.
 */
export interface BranchRef {
  readonly id: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly status: string;
  readonly updatedAt: Date;
}

export interface StationRef {
  readonly id: string;
  readonly branchId: string;
  readonly organizationId: string;
  readonly code: string;
  readonly name: string;
  readonly area: string | null;
  readonly status: string;
  readonly updatedAt: Date;
}

export interface ApplyBranchRef {
  branchId: string;
  organizationId: string;
  code: string;
  name: string;
  status: string;
  /** The payload's own timestamp (createdAt/updatedAt); the LWW key. */
  occurredAt: Date;
}

export interface ApplyStationRef {
  stationId: string;
  branchId: string;
  organizationId: string;
  code: string;
  name: string;
  area: string | null;
  status: string;
  /** The payload's own timestamp (createdAt/updatedAt); the LWW key. */
  occurredAt: Date;
}

/**
 * Write and read side of the branch projection. `apply` is a
 * last-writer-wins upsert keyed on the event's own timestamp: an event is
 * applied only if its timestamp is >= the stored updated_at, so a replayed
 * stale event (e.g. a DLQ replay) can never regress a newer status. Ties
 * resolve to the later arrival on purpose — with the per-queue serialized
 * consumer that is publication order (the directory projection's reasoning).
 *
 * The reads take the organization first because it is not a filter — it is
 * the set of rows the caller may address at all (R1). A foreign branch
 * answers null / an empty list exactly like a missing one: confirming it
 * exists elsewhere would be the leak.
 */
export interface BranchRefRepository {
  apply(input: ApplyBranchRef): Promise<void>;
  /** The active branch under this organization, or null — never a foreign row. */
  findActive(
    organizationId: string,
    branchId: string,
  ): Promise<BranchRef | null>;
  /** Active branches of the organization, ordered by name for the picker. */
  listActive(organizationId: string): Promise<BranchRef[]>;
}

/**
 * Same contract as BranchRefRepository, one level down: every read is scoped
 * by organization AND branch, because a station only means something inside
 * its branch (ADR 0016).
 */
export interface StationRefRepository {
  apply(input: ApplyStationRef): Promise<void>;
  /** The active station under this branch and organization, or null. */
  findActive(
    organizationId: string,
    branchId: string,
    stationId: string,
  ): Promise<StationRef | null>;
  /** Active stations of the branch, ordered by name for the picker. */
  listActive(organizationId: string, branchId: string): Promise<StationRef[]>;
}
