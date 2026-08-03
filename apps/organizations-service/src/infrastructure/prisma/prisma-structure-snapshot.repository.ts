import type {
  BranchSnapshotRow,
  SnapshotPage,
  StationSnapshotRow,
  StructureSnapshotRepository,
  TeamSnapshotRow,
} from '../../application/ports/structure-snapshot.repository';
import { PrismaService } from './prisma.service';

/**
 * Keyset pagination by id (Sprint 9.16).
 *
 * By id rather than by `updatedAt` because a uuid is unique and immutable: an
 * entity edited mid-run keeps its place in the ordering, so it is read exactly
 * once whether or not its timestamp moved. Ordering by a mutable column would
 * let a row that was updated behind the cursor be skipped entirely.
 *
 * One row past the requested limit is fetched to decide whether a next page
 * exists, which is cheaper and more truthful than a second COUNT.
 */
function paginate<T>(rows: T[], limit: number, idOf: (row: T) => string) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return {
    items,
    nextCursor:
      hasMore && items.length > 0 ? idOf(items[items.length - 1]) : null,
  };
}

export class PrismaStructureSnapshotRepository implements StructureSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async branches(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<BranchSnapshotRow>> {
    const rows = await this.prisma.branch.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: {
        id: true,
        organizationId: true,
        code: true,
        name: true,
        status: true,
        updatedAt: true,
      },
    });
    const page = paginate(rows, limit, (row) => row.id);
    return {
      items: page.items.map((row) => ({
        branchId: row.id,
        organizationId: row.organizationId,
        code: row.code,
        name: row.name,
        status: row.status,
        updatedAt: row.updatedAt,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async stations(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<StationSnapshotRow>> {
    const rows = await this.prisma.operationalStation.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: {
        id: true,
        branchId: true,
        code: true,
        name: true,
        area: true,
        status: true,
        updatedAt: true,
        // A station has no organization column of its own — it derives the
        // tenant through its branch, and the consumer needs it stated because
        // its own projection denormalizes it.
        branch: { select: { organizationId: true } },
      },
    });
    const page = paginate(rows, limit, (row) => row.id);
    return {
      items: page.items.map((row) => ({
        stationId: row.id,
        branchId: row.branchId,
        organizationId: row.branch.organizationId,
        code: row.code,
        name: row.name,
        area: row.area,
        status: row.status,
        updatedAt: row.updatedAt,
      })),
      nextCursor: page.nextCursor,
    };
  }

  async teams(
    after: string | null,
    limit: number,
  ): Promise<SnapshotPage<TeamSnapshotRow>> {
    const rows = await this.prisma.supportTeam.findMany({
      where: after ? { id: { gt: after } } : {},
      orderBy: { id: 'asc' },
      take: limit + 1,
      select: {
        id: true,
        organizationId: true,
        name: true,
        status: true,
        updatedAt: true,
        // Inline, in the same read, so the team and its reach cannot be
        // observed apart. Absence of rows is the organization-wide case.
        branchScopes: { select: { branchId: true } },
      },
    });
    const page = paginate(rows, limit, (row) => row.id);
    return {
      items: page.items.map((row) => ({
        teamId: row.id,
        organizationId: row.organizationId,
        name: row.name,
        status: row.status,
        branchIds: row.branchScopes.map((scope) => scope.branchId),
        updatedAt: row.updatedAt,
      })),
      nextCursor: page.nextCursor,
    };
  }
}
