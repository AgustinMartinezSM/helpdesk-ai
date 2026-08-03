import type {
  OperationalStationRepository,
  UpdateStationChanges,
} from '../../application/ports/structure.repository';
import type { OperationalStation, StationStatus } from '../../domain/branch';
import type { OperationalStation as StationRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

/**
 * Like departments, the station row derives its tenant through the branch,
 * so reads join it in to honor the domain type's organizationId.
 */
type StationRowWithBranch = StationRow & {
  branch: { organizationId: string };
};

export class PrismaOperationalStationRepository implements OperationalStationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    station: OperationalStation,
  ): Promise<OperationalStation | null> {
    // Atomic insert-or-detect; count 0 means (branch, code) is taken.
    const inserted = await this.prisma.operationalStation.createMany({
      data: [
        {
          id: station.id,
          branchId: station.branchId,
          code: station.code,
          name: station.name,
          area: station.area,
          responsibleMembershipId: station.responsibleMembershipId,
          status: station.status,
          createdAt: station.createdAt,
          updatedAt: station.updatedAt,
        },
      ],
      skipDuplicates: true,
    });
    return inserted.count === 1 ? station : null;
  }

  async findByOrganizationAndId(
    organizationId: string,
    stationId: string,
  ): Promise<OperationalStation | null> {
    const row = await this.prisma.operationalStation.findFirst({
      where: { id: stationId, branch: { organizationId } },
      include: { branch: { select: { organizationId: true } } },
    });
    return row ? toDomain(row) : null;
  }

  async list(
    organizationId: string,
    branchId: string,
  ): Promise<OperationalStation[]> {
    const rows = await this.prisma.operationalStation.findMany({
      where: { branchId, branch: { organizationId } },
      include: { branch: { select: { organizationId: true } } },
      orderBy: { code: 'asc' },
    });
    return rows.map(toDomain);
  }

  async update(
    stationId: string,
    changes: UpdateStationChanges,
    at: Date,
  ): Promise<OperationalStation> {
    const row = await this.prisma.operationalStation.update({
      where: { id: stationId },
      data: { ...changes, updatedAt: at },
      include: { branch: { select: { organizationId: true } } },
    });
    return toDomain(row);
  }
}

function toDomain(row: StationRowWithBranch): OperationalStation {
  return {
    id: row.id,
    organizationId: row.branch.organizationId,
    branchId: row.branchId,
    code: row.code,
    name: row.name,
    area: row.area,
    responsibleMembershipId: row.responsibleMembershipId,
    status: row.status as StationStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
