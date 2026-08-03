import type {
  BranchRepository,
  UpdateBranchChanges,
} from '../../application/ports/structure.repository';
import type { Branch, BranchStatus } from '../../domain/branch';
import type { Branch as BranchRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaBranchRepository implements BranchRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(branch: Branch): Promise<Branch | null> {
    // createMany with skipDuplicates is the atomic insert-or-detect the
    // membership repository established: two concurrent creates with the
    // same (organization, code) cannot both pass a pre-check and race on
    // the unique index. Count 0 means the code is taken; the caller turns
    // that into the domain's duplicate error.
    const inserted = await this.prisma.branch.createMany({
      data: [
        {
          id: branch.id,
          organizationId: branch.organizationId,
          code: branch.code,
          name: branch.name,
          status: branch.status,
          timezone: branch.timezone,
          address: branch.address,
          createdAt: branch.createdAt,
          updatedAt: branch.updatedAt,
        },
      ],
      skipDuplicates: true,
    });
    return inserted.count === 1 ? branch : null;
  }

  async findByOrganizationAndId(
    organizationId: string,
    branchId: string,
  ): Promise<Branch | null> {
    // Scoped at the query so a foreign branch and a nonexistent one produce
    // the same null — confirming existence is the leak.
    const row = await this.prisma.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    return row ? toDomain(row) : null;
  }

  async list(organizationId: string): Promise<Branch[]> {
    const rows = await this.prisma.branch.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDomain);
  }

  async update(
    branchId: string,
    changes: UpdateBranchChanges,
    at: Date,
  ): Promise<Branch> {
    const row = await this.prisma.branch.update({
      where: { id: branchId },
      data: { ...changes, updatedAt: at },
    });
    return toDomain(row);
  }
}

function toDomain(row: BranchRow): Branch {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    status: row.status as BranchStatus,
    timezone: row.timezone,
    address: row.address,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
