import type {
  DepartmentRepository,
  UpdateDepartmentChanges,
} from '../../application/ports/structure.repository';
import type { Department, DepartmentStatus } from '../../domain/branch';
import type { Department as DepartmentRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

/**
 * The department row has no organization column — the tenant is derived
 * through the branch — so every read joins the branch in and every returned
 * domain object carries the organizationId the domain type promises.
 */
type DepartmentRowWithBranch = DepartmentRow & {
  branch: { organizationId: string };
};

export class PrismaDepartmentRepository implements DepartmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(department: Department): Promise<Department | null> {
    // Atomic insert-or-detect; count 0 means (branch, name) is taken.
    const inserted = await this.prisma.department.createMany({
      data: [
        {
          id: department.id,
          branchId: department.branchId,
          name: department.name,
          status: department.status,
          createdAt: department.createdAt,
          updatedAt: department.updatedAt,
        },
      ],
      skipDuplicates: true,
    });
    return inserted.count === 1 ? department : null;
  }

  async findByOrganizationAndId(
    organizationId: string,
    departmentId: string,
  ): Promise<Department | null> {
    const row = await this.prisma.department.findFirst({
      where: { id: departmentId, branch: { organizationId } },
      include: { branch: { select: { organizationId: true } } },
    });
    return row ? toDomain(row) : null;
  }

  async findByBranchAndName(
    branchId: string,
    name: string,
  ): Promise<Department | null> {
    const row = await this.prisma.department.findFirst({
      where: { branchId, name },
      include: { branch: { select: { organizationId: true } } },
    });
    return row ? toDomain(row) : null;
  }

  async update(
    departmentId: string,
    changes: UpdateDepartmentChanges,
    at: Date,
  ): Promise<Department> {
    const row = await this.prisma.department.update({
      where: { id: departmentId },
      data: { ...changes, updatedAt: at },
      include: { branch: { select: { organizationId: true } } },
    });
    return toDomain(row);
  }
}

function toDomain(row: DepartmentRowWithBranch): Department {
  return {
    id: row.id,
    organizationId: row.branch.organizationId,
    branchId: row.branchId,
    name: row.name,
    status: row.status as DepartmentStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
