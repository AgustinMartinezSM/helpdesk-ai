import type {
  MembershipCreateResult,
  MembershipRepository,
} from '../../application/ports/membership.repository';
import type {
  Membership,
  MembershipStatus,
  RoleTemplate,
} from '../../domain/membership';
import type { Membership as MembershipRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null> {
    const row = await this.prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    return row ? toDomain(row) : null;
  }

  async listByUser(userId: string): Promise<Membership[]> {
    const rows = await this.prisma.membership.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDomain);
  }

  async createIfAbsent(
    membership: Membership,
  ): Promise<MembershipCreateResult> {
    // createMany with skipDuplicates is the atomic version of
    // read-then-insert that can also say whether it inserted: two concurrent
    // deliveries of the same registration cannot both pass an existence
    // check and then race on the unique index, and count 1 means exactly
    // "this delivery created the row". The upsert this replaces kept the row
    // safe but could not tell a replay from a first delivery, which the
    // caller now needs to publish membership.created.v1 once per row.
    const inserted = await this.prisma.membership.createMany({
      data: [
        {
          id: membership.id,
          organizationId: membership.organizationId,
          userId: membership.userId,
          roleTemplate: membership.roleTemplate,
          status: membership.status,
          version: membership.version,
          createdAt: membership.createdAt,
          updatedAt: membership.updatedAt,
        },
      ],
      skipDuplicates: true,
    });

    const row = await this.prisma.membership.findUnique({
      where: {
        organizationId_userId: {
          organizationId: membership.organizationId,
          userId: membership.userId,
        },
      },
    });
    if (!row) {
      // Only reachable if the row vanished between the two statements.
      // Memberships are never hard-deleted — deactivation is the terminal
      // state — so this is a bug worth dead-lettering the delivery over.
      throw new Error(
        `membership for user ${membership.userId} in organization ${membership.organizationId} disappeared during createIfAbsent`,
      );
    }
    return { membership: toDomain(row), created: inserted.count === 1 };
  }

  async changeStatus(
    membershipId: string,
    to: MembershipStatus,
    at: Date,
  ): Promise<Membership> {
    // One atomic UPDATE: the version bump rides the same statement as the
    // status write because the bump is what invalidates the `mv` claim in
    // outstanding tokens (ADR 0014) — a status change that could commit
    // without it would leave a suspended member holding a token nothing
    // flags as stale.
    const row = await this.prisma.membership.update({
      where: { id: membershipId },
      data: { status: to, version: { increment: 1 }, updatedAt: at },
    });
    return toDomain(row);
  }
}

function toDomain(row: MembershipRow): Membership {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    roleTemplate: row.roleTemplate as RoleTemplate,
    status: row.status as MembershipStatus,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
