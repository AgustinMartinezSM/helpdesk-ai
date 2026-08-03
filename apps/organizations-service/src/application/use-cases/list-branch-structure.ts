import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { Department, OperationalStation } from '../../domain/branch';
import { BranchNotFoundError } from '../../domain/errors';
import { requireStructureAdministrator } from '../structure-administration';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  BranchRepository,
  DepartmentRepository,
  OperationalStationRepository,
} from '../ports/structure.repository';

/** A station plus the person who answers for it, named the public way. */
export interface StationView {
  readonly station: OperationalStation;
  /** Null when nobody answers for it, or when that membership is gone. */
  readonly responsibleUserId: string | null;
}

export interface BranchStructure {
  readonly departments: Department[];
  readonly stations: StationView[];
}

/**
 * Everything inside one branch, for the setup screen (Sprint 9.11).
 *
 * One use case rather than two because the screen shows both together and a
 * department list without its branch is a list of names. Archived rows come
 * back: a screen that cannot see what it archived cannot un-archive it.
 *
 * The station's responsible person is translated from the membership id the
 * column holds into the `userId` the rest of the public surface speaks (D3),
 * in one extra query rather than one per station. A membership that has since
 * disappeared resolves to null rather than failing the listing — the schema's
 * SET NULL says losing a manager must never take the place down, and a read
 * that refused would contradict it.
 */
export class ListBranchStructureUseCase {
  constructor(
    private readonly branches: BranchRepository,
    private readonly departments: DepartmentRepository,
    private readonly stations: OperationalStationRepository,
    private readonly memberships: MembershipRepository,
  ) {}

  async execute(actor: Actor, branchId: string): Promise<BranchStructure> {
    const organizationId = requireStructureAdministrator(
      actor,
      PERMISSIONS.BRANCHES_READ,
    );

    const branch = await this.branches.findByOrganizationAndId(
      organizationId,
      branchId,
    );
    if (!branch) {
      throw new BranchNotFoundError(organizationId, branchId);
    }

    const [departments, stations] = await Promise.all([
      this.departments.list(organizationId, branch.id),
      this.stations.list(organizationId, branch.id),
    ]);

    const responsibleIds = [
      ...new Set(
        stations
          .map((station) => station.responsibleMembershipId)
          .filter((id): id is string => id !== null),
      ),
    ];
    const responsible = await this.memberships.listByOrganizationAndIds(
      organizationId,
      responsibleIds,
    );
    const userIdByMembership = new Map(
      responsible.map((membership) => [membership.id, membership.userId]),
    );

    return {
      departments,
      stations: stations.map((station) => ({
        station,
        responsibleUserId:
          station.responsibleMembershipId === null
            ? null
            : (userIdByMembership.get(station.responsibleMembershipId) ?? null),
      })),
    };
  }
}
