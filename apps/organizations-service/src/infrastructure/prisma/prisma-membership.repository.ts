import type {
  MembershipCreateResult,
  MembershipRepository,
  TransferOwnershipInput,
  TransferredOwnership,
} from '../../application/ports/membership.repository';
import {
  OWNER_ROLE_TEMPLATE,
  SUCCEEDED_OWNER_ROLE_TEMPLATE,
  type Membership,
  type MembershipStatus,
  type RoleTemplate,
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

  async changeRoleTemplate(
    membershipId: string,
    to: RoleTemplate,
    at: Date,
  ): Promise<Membership> {
    // Same one-statement shape as changeStatus, for the same reason: the
    // bump makes every outstanding token's `perms` snapshot detectably
    // stale in the very statement that changes what it should say.
    const row = await this.prisma.membership.update({
      where: { id: membershipId },
      data: { roleTemplate: to, version: { increment: 1 }, updatedAt: at },
    });
    return toDomain(row);
  }

  async findByOrganizationAndId(
    organizationId: string,
    membershipId: string,
  ): Promise<Membership | null> {
    // Scoped at the query so a foreign membership and a nonexistent one
    // produce the same null — the port's no-existence-leak contract.
    const row = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
    });
    return row ? toDomain(row) : null;
  }

  async listByOrganizationAndIds(
    organizationId: string,
    membershipIds: string[],
  ): Promise<Membership[]> {
    if (membershipIds.length === 0) {
      return [];
    }
    const rows = await this.prisma.membership.findMany({
      where: { id: { in: membershipIds }, organizationId },
    });
    return rows.map(toDomain);
  }

  async findOwner(organizationId: string): Promise<Membership | null> {
    // findFirst rather than findUnique: the "one owner per organization" rule
    // is a PARTIAL unique index (WHERE role_template = 'owner'), which Prisma's
    // schema language cannot express, so the generated client has no unique
    // lookup for it. The index still plans this query and still refuses a
    // second owner at write time, which is where it matters.
    const row = await this.prisma.membership.findFirst({
      where: { organizationId, roleTemplate: OWNER_ROLE_TEMPLATE },
    });
    return row ? toDomain(row) : null;
  }

  async transferOwnership(
    input: TransferOwnershipInput,
  ): Promise<TransferredOwnership | null> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        /**
         * DEMOTE BEFORE PROMOTE, and the order is not stylistic: the partial
         * unique index allows at most one `owner` row per organization and is
         * checked per statement, not deferred to commit. Promoting first would
         * make the transaction fail against its own index every time.
         *
         * Both statements are CONDITIONAL updateMany calls, the shape
         * invitation redemption uses. The first one carries the whole
         * concurrency argument: `role_template = 'owner'` in the WHERE clause
         * is what serializes two transfers of the same organization. The second
         * request blocks on this row's lock, re-reads it after the first
         * commits, no longer matches, and reports count 0 — so the loser
         * changes nothing rather than racing the winner to a second owner.
         */
        const demoted = await tx.membership.updateMany({
          where: {
            id: input.fromMembershipId,
            organizationId: input.organizationId,
            roleTemplate: OWNER_ROLE_TEMPLATE,
          },
          data: {
            roleTemplate: SUCCEEDED_OWNER_ROLE_TEMPLATE,
            version: { increment: 1 },
            updatedAt: input.at,
          },
        });
        if (demoted.count !== 1) {
          throw new StaleOwnership();
        }

        // `status: 'active'` is re-checked here rather than trusted from the
        // use case's read: between that read and this write somebody holding
        // people.suspend could have suspended the person about to be handed
        // the organization.
        const promoted = await tx.membership.updateMany({
          where: {
            id: input.toMembershipId,
            organizationId: input.organizationId,
            status: 'active',
            roleTemplate: { not: OWNER_ROLE_TEMPLATE },
          },
          data: {
            roleTemplate: OWNER_ROLE_TEMPLATE,
            version: { increment: 1 },
            updatedAt: input.at,
          },
        });
        if (promoted.count !== 1) {
          // The throw is the point: it rolls the demotion back, so a transfer
          // that cannot finish leaves the original owner exactly as they were
          // rather than leaving the organization with nobody at the top.
          throw new StaleOwnership();
        }

        const [previousOwner, newOwner] = await Promise.all([
          tx.membership.findUnique({ where: { id: input.fromMembershipId } }),
          tx.membership.findUnique({ where: { id: input.toMembershipId } }),
        ]);
        if (!previousOwner || !newOwner) {
          // Both were written inside this transaction; their absence means
          // something deleted them underneath it. Rolling back beats reporting
          // a transfer whose result cannot be read back.
          throw new Error(
            `membership ${input.fromMembershipId} or ${input.toMembershipId} disappeared during an ownership transfer`,
          );
        }

        return {
          previousOwner: toDomain(previousOwner),
          newOwner: toDomain(newOwner),
        };
      });
    } catch (error) {
      if (error instanceof StaleOwnership) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * Thrown to roll the transaction back, caught immediately outside it, never
 * seen by a caller. Returning null from inside the callback would COMMIT the
 * demotion that had already run — which is the exact half-transfer this whole
 * method exists to make impossible.
 */
class StaleOwnership extends Error {}

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
