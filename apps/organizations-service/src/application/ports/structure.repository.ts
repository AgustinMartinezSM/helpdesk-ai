import type {
  Branch,
  BranchMembership,
  BranchStatus,
  Department,
  DepartmentStatus,
  OperationalStation,
  StationStatus,
} from '../../domain/branch';

/**
 * Persistence ports for the organizational structure (Sprint 9.5).
 *
 * Every read is scoped by organization ON THE PORT, not left to callers: a
 * foreign row and a nonexistent one must be indistinguishable at this
 * boundary, so no method exists that could fetch a branch without saying
 * whose it is. The fakes enforce the same scope for real — a spec that
 * hands them a foreign id gets the same null the database would give.
 *
 * `create` methods answer null when the parent-scoped unique key is taken
 * (the ON CONFLICT DO NOTHING shape createIfAbsent set): the insert and the
 * duplicate check are one atomic statement, so two concurrent creates with
 * the same code cannot both pass a pre-check and race on the index.
 */

export const BRANCH_REPOSITORY = Symbol('BRANCH_REPOSITORY');

export interface UpdateBranchChanges {
  name?: string;
  status?: BranchStatus;
  /** null clears the column; undefined leaves it alone. */
  timezone?: string | null;
  address?: string | null;
}

export interface BranchRepository {
  /** Null when (organizationId, code) is already taken. */
  create(branch: Branch): Promise<Branch | null>;
  findByOrganizationAndId(
    organizationId: string,
    branchId: string,
  ): Promise<Branch | null>;
  /**
   * Every branch of one organization, ordered by name, ARCHIVED ONES
   * INCLUDED. A membership can still cover an archived branch — archival
   * never drops the edge — so a listing that hid them would let a branch
   * editor silently drop one on save. Callers filter for pickers.
   */
  list(organizationId: string): Promise<Branch[]>;
  /** Applies the provided fields and stamps `at` as updatedAt. */
  update(
    branchId: string,
    changes: UpdateBranchChanges,
    at: Date,
  ): Promise<Branch>;
}

export const DEPARTMENT_REPOSITORY = Symbol('DEPARTMENT_REPOSITORY');

export interface UpdateDepartmentChanges {
  name?: string;
  status?: DepartmentStatus;
}

export interface DepartmentRepository {
  /** Null when (branchId, name) is already taken. */
  create(department: Department): Promise<Department | null>;
  findByOrganizationAndId(
    organizationId: string,
    departmentId: string,
  ): Promise<Department | null>;
  /**
   * Departments of one branch, ordered by name, archived ones INCLUDED —
   * the same rule the branch listing follows (Sprint 9.10, D8): a management
   * screen that cannot see what it archived cannot un-archive it. Scoped by
   * organization as well as branch so a foreign branch id lists nothing.
   */
  list(organizationId: string, branchId: string): Promise<Department[]>;
  /**
   * The pre-rename duplicate check. The unique index stays the backstop for
   * the write itself; this exists so an ordinary collision surfaces as a
   * domain error rather than a driver exception.
   */
  findByBranchAndName(
    branchId: string,
    name: string,
  ): Promise<Department | null>;
  update(
    departmentId: string,
    changes: UpdateDepartmentChanges,
    at: Date,
  ): Promise<Department>;
}

export const STATION_REPOSITORY = Symbol('STATION_REPOSITORY');

export interface UpdateStationChanges {
  name?: string;
  status?: StationStatus;
  /** null clears the column; undefined leaves it alone. */
  area?: string | null;
  responsibleMembershipId?: string | null;
}

export interface OperationalStationRepository {
  /** Null when (branchId, code) is already taken. */
  create(station: OperationalStation): Promise<OperationalStation | null>;
  findByOrganizationAndId(
    organizationId: string,
    stationId: string,
  ): Promise<OperationalStation | null>;
  /** Stations of one branch, ordered by code, archived ones included. */
  list(organizationId: string, branchId: string): Promise<OperationalStation[]>;
  update(
    stationId: string,
    changes: UpdateStationChanges,
    at: Date,
  ): Promise<OperationalStation>;
}

export const BRANCH_MEMBERSHIP_REPOSITORY = Symbol(
  'BRANCH_MEMBERSHIP_REPOSITORY',
);

export interface BranchMembershipRepository {
  /**
   * Idempotent (ON CONFLICT DO NOTHING): assigning an already-assigned
   * branch is a no-op, not an error — unlike a role change, this edge has no
   * version and no consumer to mislead, so absorbing the replay is safe.
   */
  assign(edge: BranchMembership): Promise<void>;
  /** Idempotent: removing an absent edge succeeds silently. */
  remove(membershipId: string, branchId: string): Promise<void>;
  /**
   * Branch ids covered by one membership, INCLUDING archived branches: a
   * manager keeps seeing the history of a store that closed. Archival hides
   * a branch from pickers, never from the people who covered it.
   */
  listBranchIds(membershipId: string): Promise<string[]>;
}
