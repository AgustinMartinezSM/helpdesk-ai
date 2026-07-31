import type { Department } from '../../domain/branch';
import {
  BranchNotFoundError,
  DuplicateDepartmentNameError,
} from '../../domain/errors';
import type {
  BranchRepository,
  DepartmentRepository,
} from '../ports/structure.repository';
import type { Clock, IdGenerator } from '../ports/organization.repository';

export interface CreateDepartmentInput {
  organizationId: string;
  branchId: string;
  name: string;
}

/**
 * Adds a department under a branch. Rows and memberships exist per
 * ADR 0016's shape, but nothing keys on them yet — routing will
 * (Sprint 9.11).
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

  async execute(input: CreateDepartmentInput): Promise<Department> {
    const branch = await this.branches.findByOrganizationAndId(
      input.organizationId,
      input.branchId,
    );
    if (!branch) {
      throw new BranchNotFoundError(input.organizationId, input.branchId);
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
