import type { Department, DepartmentStatus } from '../../domain/branch';
import {
  DepartmentNotFoundError,
  DuplicateDepartmentNameError,
} from '../../domain/errors';
import type { DepartmentRepository } from '../ports/structure.repository';
import type { Clock } from '../ports/organization.repository';

export interface UpdateDepartmentInput {
  organizationId: string;
  departmentId: string;
  name?: string;
  status?: DepartmentStatus;
}

/**
 * Renames or archives a department. Same lifecycle stance as branches —
 * archived is reversible, no transition table, no version — and the same
 * silence on the bus as creation: no consumer, no contract.
 *
 * A rename is checked against the branch's other departments first so an
 * ordinary collision answers 409; the unique index stays the backstop for
 * the write race, where the driver error is a bug report, not an expected
 * answer.
 */
export class UpdateDepartmentUseCase {
  constructor(
    private readonly departments: DepartmentRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: UpdateDepartmentInput): Promise<Department> {
    const department = await this.departments.findByOrganizationAndId(
      input.organizationId,
      input.departmentId,
    );
    if (!department) {
      throw new DepartmentNotFoundError(
        input.organizationId,
        input.departmentId,
      );
    }

    if (input.name !== undefined && input.name !== department.name) {
      const taken = await this.departments.findByBranchAndName(
        department.branchId,
        input.name,
      );
      if (taken) {
        throw new DuplicateDepartmentNameError(department.branchId, input.name);
      }
    }

    return this.departments.update(
      department.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      this.clock.now(),
    );
  }
}
