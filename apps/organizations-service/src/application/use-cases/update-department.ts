import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { Department, DepartmentStatus } from '../../domain/branch';
import {
  DepartmentNotFoundError,
  DuplicateDepartmentNameError,
} from '../../domain/errors';
import { requireStructureAdministrator } from '../structure-administration';
import type { DepartmentRepository } from '../ports/structure.repository';
import type { Clock } from '../ports/organization.repository';

export interface UpdateDepartmentInput {
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

  async execute(
    actor: Actor,
    input: UpdateDepartmentInput,
  ): Promise<Department> {
    const organizationId = requireStructureAdministrator(
      actor,
      PERMISSIONS.BRANCHES_UPDATE,
    );

    const department = await this.departments.findByOrganizationAndId(
      organizationId,
      input.departmentId,
    );
    if (!department) {
      throw new DepartmentNotFoundError(organizationId, input.departmentId);
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
