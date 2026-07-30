import type { MembershipRepository } from '../../application/ports/membership.repository';
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

  async createIfAbsent(membership: Membership): Promise<Membership> {
    // An upsert with an empty `update` is the atomic version of
    // read-then-insert: two concurrent deliveries of the same registration
    // cannot both pass an existence check and then race on the unique index.
    // The empty update is what makes a replay leave the stored row alone.
    const row = await this.prisma.membership.upsert({
      where: {
        organizationId_userId: {
          organizationId: membership.organizationId,
          userId: membership.userId,
        },
      },
      create: {
        id: membership.id,
        organizationId: membership.organizationId,
        userId: membership.userId,
        roleTemplate: membership.roleTemplate,
        status: membership.status,
        version: membership.version,
        createdAt: membership.createdAt,
        updatedAt: membership.updatedAt,
      },
      update: {},
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
