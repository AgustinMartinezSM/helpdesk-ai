import type {
  SupportTeamRepository,
  UpdateSupportTeamChanges,
} from '../../application/ports/support-team.repository';
import type { SupportTeam, SupportTeamStatus } from '../../domain/support-team';
import type { SupportTeam as SupportTeamRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaSupportTeamRepository implements SupportTeamRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(team: SupportTeam): Promise<SupportTeam | null> {
    // createMany with skipDuplicates is the atomic insert-or-detect the rest
    // of this service uses: two concurrent creates with the same
    // (organization, code) cannot both pass a pre-check and race on the index.
    const inserted = await this.prisma.supportTeam.createMany({
      data: [
        {
          id: team.id,
          organizationId: team.organizationId,
          code: team.code,
          name: team.name,
          status: team.status,
          createdAt: team.createdAt,
          updatedAt: team.updatedAt,
        },
      ],
      skipDuplicates: true,
    });
    return inserted.count === 1 ? team : null;
  }

  async findByOrganizationAndId(
    organizationId: string,
    teamId: string,
  ): Promise<SupportTeam | null> {
    // Scoped at the query so a foreign team and a nonexistent one produce the
    // same null — the port's no-existence-leak contract.
    const row = await this.prisma.supportTeam.findFirst({
      where: { id: teamId, organizationId },
    });
    return row ? toDomain(row) : null;
  }

  async list(organizationId: string): Promise<SupportTeam[]> {
    const rows = await this.prisma.supportTeam.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDomain);
  }

  async update(
    teamId: string,
    changes: UpdateSupportTeamChanges,
    at: Date,
  ): Promise<SupportTeam> {
    const row = await this.prisma.supportTeam.update({
      where: { id: teamId },
      data: { ...changes, updatedAt: at },
    });
    return toDomain(row);
  }

  async setMembers(
    teamId: string,
    membershipIds: string[],
    at: Date,
  ): Promise<void> {
    // One transaction: a replace that deleted and then failed to insert would
    // silently empty a team, which reads to everybody in it as losing access.
    await this.prisma.$transaction([
      this.prisma.supportTeamMembership.deleteMany({
        where: { teamId, membershipId: { notIn: membershipIds } },
      }),
      this.prisma.supportTeamMembership.createMany({
        data: membershipIds.map((membershipId) => ({
          teamId,
          membershipId,
          createdAt: at,
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  async listMemberIds(teamId: string): Promise<string[]> {
    const rows = await this.prisma.supportTeamMembership.findMany({
      where: { teamId },
      select: { membershipId: true },
    });
    return rows.map((row) => row.membershipId);
  }

  async listActiveTeamIdsForMembership(
    membershipId: string,
  ): Promise<string[]> {
    // Archived teams are excluded here and nowhere else: this read mints the
    // `tm` claim, and a team nobody works any more must stop granting
    // visibility.
    const rows = await this.prisma.supportTeamMembership.findMany({
      where: { membershipId, team: { status: 'active' } },
      select: { teamId: true },
    });
    return rows.map((row) => row.teamId);
  }

  async setBranchScope(
    teamId: string,
    branchIds: string[],
    at: Date,
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.supportTeamBranch.deleteMany({
        where: { teamId, branchId: { notIn: branchIds } },
      }),
      this.prisma.supportTeamBranch.createMany({
        data: branchIds.map((branchId) => ({
          teamId,
          branchId,
          createdAt: at,
        })),
        skipDuplicates: true,
      }),
    ]);
  }

  async listBranchIds(teamId: string): Promise<string[]> {
    const rows = await this.prisma.supportTeamBranch.findMany({
      where: { teamId },
      select: { branchId: true },
    });
    return rows.map((row) => row.branchId);
  }
}

function toDomain(row: SupportTeamRow): SupportTeam {
  return {
    id: row.id,
    organizationId: row.organizationId,
    code: row.code,
    name: row.name,
    status: row.status as SupportTeamStatus,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
