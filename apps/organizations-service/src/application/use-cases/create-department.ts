import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { Department } from '../../domain/branch';
import {
  BranchNotFoundError,
  DuplicateDepartmentNameError,
} from '../../domain/errors';
import { requireStructureAdministrator } from '../structure-administration';
import type {
  BranchRepository,
  DepartmentRepository,
} from '../ports/structure.repository';
import type { Clock, IdGenerator } from '../ports/organization.repository';

export interface CreateDepartmentInput {
  branchId: string;
  name: string;
}

/**
 * Adds a department under a branch. Rows and memberships exist per
 * ADR 0016's shape, but nothing keys on them yet — routing will
 * (Sprint 9.12).
 *
 * Gated on `branches.update` rather than a key of its own: a department is
 * not a scope, it is the contents of one, and the approved matrix has no row
 * for it (Sprint 9.11, D1).
 *
 * NO event, deliberately: no consumer exists, and a contract nobody reads
 * is a promise nobody keeps. When routing needs departments, that sprint
 * introduces the contract alongside its first consumer.
 */
export class CreateDepartmentUseCase {
  constructor(
    private readonly branches: BranchRepository,
    private readonly departments: DepartmentRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(
    actor: Actor,
    input: CreateDepartmentInput,
  ): Promise<Department> {
    const organizationId = requireStructureAdministrator(
      actor,
      PERMISSIONS.BRANCHES_UPDATE,
    );

    const branch = await this.branches.findByOrganizationAndId(
      organizationId,
      input.branchId,
    );
    if (!branch) {
      throw new BranchNotFoundError(organizationId, input.branchId);
    }

    const now = this.clock.now();
    const created = await this.departments.create({
      id: this.ids.next(),
      organizationId: branch.organizationId,
      branchId: branch.id,
      name: input.name,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    if (!created) {
      throw new DuplicateDepartmentNameError(branch.id, input.name);
    }
    return created;
  }
}
