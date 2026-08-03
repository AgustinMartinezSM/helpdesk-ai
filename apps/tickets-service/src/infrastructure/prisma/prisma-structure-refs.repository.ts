import {
  ACTIVE_REF_STATUS,
  type ApplyBranchRef,
  type ApplyStationRef,
  type BranchRef,
  type BranchRefRepository,
  type StationRef,
  type StationRefRepository,
  type ApplyTeamRef,
  type ApplyTeamScope,
  type TeamRef,
  type TeamRefRepository,
} from '../../application/ports/structure-refs.repository';
import type { PrismaService } from './prisma.service';

/**
 * Single-statement upserts with the LWW guard evaluated INSIDE Postgres,
 * mirroring users-service's membership projection: two events for the same
 * row applied concurrently cannot both read a stale updated_at (the row
 * lock serializes the DO UPDATE), and a replayed stale event can never
 * regress a newer status. Ties (identical timestamps) resolve to the later
 * arrival on purpose: with the per-queue serialized consumer that is
 * publication order.
 *
 * Every column is guarded by the same timestamp comparison because the
 * projection stores last-write STATE — the row is replaced with whatever
 * the winning event says, never merged field by field across events.
 */
export class PrismaBranchRefRepository implements BranchRefRepository {
  constructor(private readonly prisma: PrismaService) {}

  async apply(input: ApplyBranchRef): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO branch_refs
        (id, organization_id, code, name, status, updated_at)
      VALUES
        (${input.branchId}::uuid, ${input.organizationId}::uuid,
         ${input.code}, ${input.name}, ${input.status}, ${input.occurredAt})
      ON CONFLICT (id) DO UPDATE SET
        organization_id = CASE
          WHEN branch_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.organization_id
          ELSE branch_refs.organization_id END,
        code = CASE
          WHEN branch_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.code ELSE branch_refs.code END,
        name = CASE
          WHEN branch_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.name ELSE branch_refs.name END,
        status = CASE
          WHEN branch_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.status ELSE branch_refs.status END,
        updated_at = GREATEST(branch_refs.updated_at, EXCLUDED.updated_at)
    `;
  }

  async findActive(
    organizationId: string,
    branchId: string,
  ): Promise<BranchRef | null> {
    // findFirst with the organization in the predicate, like the ticket
    // reads: a foreign branch answers null rather than being fetched and
    // then judged.
    const row = await this.prisma.branchRef.findFirst({
      where: { id: branchId, organizationId, status: ACTIVE_REF_STATUS },
    });
    return row;
  }

  async listActive(organizationId: string): Promise<BranchRef[]> {
    return this.prisma.branchRef.findMany({
      where: { organizationId, status: ACTIVE_REF_STATUS },
      orderBy: { name: 'asc' },
    });
  }
}

export class PrismaStationRefRepository implements StationRefRepository {
  constructor(private readonly prisma: PrismaService) {}

  async apply(input: ApplyStationRef): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO station_refs
        (id, branch_id, organization_id, code, name, area, status, updated_at)
      VALUES
        (${input.stationId}::uuid, ${input.branchId}::uuid,
         ${input.organizationId}::uuid, ${input.code}, ${input.name},
         ${input.area}, ${input.status}, ${input.occurredAt})
      ON CONFLICT (id) DO UPDATE SET
        branch_id = CASE
          WHEN station_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.branch_id ELSE station_refs.branch_id END,
        organization_id = CASE
          WHEN station_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.organization_id
          ELSE station_refs.organization_id END,
        code = CASE
          WHEN station_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.code ELSE station_refs.code END,
        name = CASE
          WHEN station_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.name ELSE station_refs.name END,
        area = CASE
          WHEN station_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.area ELSE station_refs.area END,
        status = CASE
          WHEN station_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.status ELSE station_refs.status END,
        updated_at = GREATEST(station_refs.updated_at, EXCLUDED.updated_at)
    `;
  }

  async findActive(
    organizationId: string,
    branchId: string,
    stationId: string,
  ): Promise<StationRef | null> {
    // Branch AND organization in the predicate: a station of another branch
    // (or tenant) answers null exactly like a guessed id.
    const row = await this.prisma.stationRef.findFirst({
      where: {
        id: stationId,
        branchId,
        organizationId,
        status: ACTIVE_REF_STATUS,
      },
    });
    return row;
  }

  async listActive(
    organizationId: string,
    branchId: string,
  ): Promise<StationRef[]> {
    return this.prisma.stationRef.findMany({
      where: { branchId, organizationId, status: ACTIVE_REF_STATUS },
      orderBy: { name: 'asc' },
    });
  }
}

/**
 * The support team projection (Sprint 9.12, ADR 0022).
 *
 * Same last-writer-wins upsert as the branch one, plus a second apply for
 * the branch scope. The scope replace runs in a transaction with the same
 * LWW guard: a stale scope event must not widen or narrow a team that a
 * newer one already settled.
 */
export class PrismaTeamRefRepository implements TeamRefRepository {
  constructor(private readonly prisma: PrismaService) {}

  async apply(input: ApplyTeamRef): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO team_refs
        (id, organization_id, name, status, updated_at)
      VALUES
        (${input.teamId}::uuid, ${input.organizationId}::uuid,
         ${input.name}, ${input.status}, ${input.occurredAt})
      ON CONFLICT (id) DO UPDATE SET
        organization_id = CASE
          WHEN team_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.organization_id
          ELSE team_refs.organization_id END,
        name = CASE
          WHEN team_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.name ELSE team_refs.name END,
        status = CASE
          WHEN team_refs.updated_at <= EXCLUDED.updated_at
          THEN EXCLUDED.status ELSE team_refs.status END,
        updated_at = GREATEST(team_refs.updated_at, EXCLUDED.updated_at)
    `;
  }

  async applyScope(input: ApplyTeamScope): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // The team row has to exist before its scope can hang off it, and a
      // scope event can outrun the created event on a cold projection.
      // Upserting a placeholder keeps the edge rather than dropping it; the
      // real name and status arrive with their own LWW apply and win,
      // because this placeholder carries the oldest possible timestamp.
      await tx.$executeRaw`
        INSERT INTO team_refs (id, organization_id, name, status, updated_at)
        VALUES (${input.teamId}::uuid, ${input.organizationId}::uuid,
                '', 'active', ${new Date(0)})
        ON CONFLICT (id) DO NOTHING
      `;

      const current = await tx.teamRef.findUnique({
        where: { id: input.teamId },
        select: { updatedAt: true },
      });
      if (current && current.updatedAt > input.occurredAt) {
        // A newer fact already settled this team; a stale replay must not
        // reopen its reach.
        return;
      }

      await tx.teamBranchRef.deleteMany({
        where: { teamId: input.teamId, branchId: { notIn: input.branchIds } },
      });
      await tx.teamBranchRef.createMany({
        data: input.branchIds.map((branchId) => ({
          teamId: input.teamId,
          branchId,
        })),
        skipDuplicates: true,
      });
    });
  }

  async findActive(
    organizationId: string,
    teamId: string,
  ): Promise<TeamRef | null> {
    const row = await this.prisma.teamRef.findFirst({
      where: { id: teamId, organizationId, status: ACTIVE_REF_STATUS },
      include: { branches: { select: { branchId: true } } },
    });
    return row ? toTeamRef(row) : null;
  }

  async listActive(organizationId: string): Promise<TeamRef[]> {
    const rows = await this.prisma.teamRef.findMany({
      where: { organizationId, status: ACTIVE_REF_STATUS },
      include: { branches: { select: { branchId: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map(toTeamRef);
  }
}

function toTeamRef(row: {
  id: string;
  organizationId: string;
  name: string;
  status: string;
  updatedAt: Date;
  branches: { branchId: string }[];
}): TeamRef {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    status: row.status,
    updatedAt: row.updatedAt,
    // Empty means organization-wide. Callers must not read it as "serves
    // nothing" — see the port.
    branchIds: row.branches.map((branch) => branch.branchId),
  };
}
