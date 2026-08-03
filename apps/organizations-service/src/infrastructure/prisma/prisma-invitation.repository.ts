import type {
  InvitationListFilter,
  InvitationRepository,
  RedeemInvitationInput,
  RedeemInvitationResult,
} from '../../application/ports/invitation.repository';
import { DuplicatePendingInvitationError } from '../../domain/errors';
import type { Invitation, InvitationStatus } from '../../domain/invitation';
import type {
  Membership,
  MembershipStatus,
  RoleTemplate,
} from '../../domain/membership';
import type {
  Invitation as InvitationRow,
  Membership as MembershipRow,
} from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

/** Postgres unique-violation, surfaced by Prisma as P2002. */
const UNIQUE_VIOLATION = 'P2002';

export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(invitation: Invitation): Promise<Invitation> {
    try {
      const row = await this.prisma.invitation.create({
        data: toRow(invitation),
      });
      return toDomain(row);
    } catch (error) {
      // The partial unique index is the decision, not a prior read: two
      // concurrent issues for the same address cannot both commit, and the
      // loser lands here rather than creating a second live code.
      if (isUniqueViolation(error)) {
        throw new DuplicatePendingInvitationError(invitation.organizationId);
      }
      throw error;
    }
  }

  async findById(invitationId: string): Promise<Invitation | null> {
    const row = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    return row ? toDomain(row) : null;
  }

  async findByOrganizationAndId(
    organizationId: string,
    invitationId: string,
  ): Promise<Invitation | null> {
    // Scoped at the query so a foreign invitation and a nonexistent one
    // produce the same null.
    const row = await this.prisma.invitation.findFirst({
      where: { id: invitationId, organizationId },
    });
    return row ? toDomain(row) : null;
  }

  async list(filter: InvitationListFilter): Promise<Invitation[]> {
    const rows = await this.prisma.invitation.findMany({
      where: {
        organizationId: filter.organizationId,
        ...(filter.status ? { status: filter.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: filter.offset,
      take: filter.limit,
    });
    return rows.map(toDomain);
  }

  async findStatusesByEmails(
    organizationId: string,
    emails: readonly string[],
  ): Promise<Map<string, 'pending' | 'accepted'>> {
    if (emails.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.invitation.findMany({
      where: {
        organizationId,
        inviteeEmail: { in: [...new Set(emails)] },
        status: { in: ['pending', 'accepted'] },
      },
      select: { inviteeEmail: true, status: true },
    });

    const statuses = new Map<string, 'pending' | 'accepted'>();
    for (const row of rows) {
      // `accepted` wins over `pending`: somebody re-invited after joining has
      // both, and being a member is the stronger fact — reporting them as
      // merely invited would suggest an outstanding code that means nothing.
      const status = row.status as 'pending' | 'accepted';
      if (status === 'accepted' || !statuses.has(row.inviteeEmail)) {
        statuses.set(row.inviteeEmail, status);
      }
    }
    return statuses;
  }

  async redeem(
    input: RedeemInvitationInput,
  ): Promise<RedeemInvitationResult | null> {
    return this.prisma.$transaction(async (tx) => {
      // Conditional UPDATE, not read-then-write: `updateMany` with the status
      // in the WHERE clause is what serializes two concurrent redemptions of
      // the same code. count 0 means another request already consumed it, and
      // the caller turns that into the same generic refusal every other
      // non-redeemable reason gets.
      const consumed = await tx.invitation.updateMany({
        where: { id: input.invitationId, status: 'pending' },
        data: {
          status: 'accepted',
          acceptedByUserId: input.acceptedByUserId,
          acceptedAt: input.at,
          updatedAt: input.at,
        },
      });
      if (consumed.count === 0) {
        return null;
      }

      // Same createMany/skipDuplicates shape the membership repository uses,
      // for the same reason: it inserts atomically AND reports whether this
      // call is what inserted, so a person who already belonged keeps their
      // existing role instead of being silently rewritten to the invited one.
      const inserted = await tx.membership.createMany({
        data: [toMembershipRow(input.membership)],
        skipDuplicates: true,
      });
      const membership = await tx.membership.findUnique({
        where: {
          organizationId_userId: {
            organizationId: input.membership.organizationId,
            userId: input.membership.userId,
          },
        },
      });
      const invitation = await tx.invitation.findUnique({
        where: { id: input.invitationId },
      });
      if (!membership || !invitation) {
        // Both were written or read inside this transaction; their absence
        // means something deleted them underneath it. Rolling back is safer
        // than reporting a redemption that may not have produced a member.
        throw new Error(
          `invitation ${input.invitationId} or its membership disappeared during redemption`,
        );
      }

      // The placement a CSV import put on the invitation (Sprint 9.15),
      // applied HERE so it lands in the same transaction as the membership it
      // belongs to — a second write outside would be the split this service
      // exists to avoid (ADR 0019), and would leave a member placed nowhere
      // with nothing to retry it.
      //
      // skipDuplicates, so redeeming a second invitation for somebody already
      // in that branch is not an error. Only applied when the membership row
      // is new: an existing member keeps the placement they have, for the same
      // reason they keep their existing role.
      if (inserted.count === 1) {
        if (invitation.branchId) {
          await tx.branchMembership.createMany({
            data: [
              {
                membershipId: membership.id,
                branchId: invitation.branchId,
                createdAt: input.at,
              },
            ],
            skipDuplicates: true,
          });
        }
        if (invitation.departmentId) {
          await tx.departmentMembership.createMany({
            data: [
              {
                membershipId: membership.id,
                departmentId: invitation.departmentId,
                createdAt: input.at,
              },
            ],
            skipDuplicates: true,
          });
        }
      }

      return {
        invitation: toDomain(invitation),
        membership: toMembershipDomain(membership),
        membershipCreated: inserted.count === 1,
      };
    });
  }

  async revoke(
    organizationId: string,
    invitationId: string,
    revokedAt: Date,
  ): Promise<Invitation | null> {
    // Organization and status both in the WHERE clause: a foreign invitation
    // and an already-consumed one are equally untouched, and a revoke that
    // loses a race with a redemption reports the loss instead of overwriting
    // a membership that already exists.
    const updated = await this.prisma.invitation.updateMany({
      where: { id: invitationId, organizationId, status: 'pending' },
      data: { status: 'revoked', updatedAt: revokedAt },
    });
    if (updated.count === 0) {
      return null;
    }
    const row = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });
    return row ? toDomain(row) : null;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === UNIQUE_VIOLATION
  );
}

function toRow(invitation: Invitation) {
  return {
    id: invitation.id,
    organizationId: invitation.organizationId,
    inviteeEmail: invitation.inviteeEmail,
    roleTemplate: invitation.roleTemplate,
    status: invitation.status,
    codeHash: invitation.codeHash,
    invitedByUserId: invitation.invitedByUserId,
    branchId: invitation.branchId,
    departmentId: invitation.departmentId,
    expiresAt: invitation.expiresAt,
    acceptedByUserId: invitation.acceptedByUserId,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
    updatedAt: invitation.updatedAt,
  };
}

function toMembershipRow(membership: Membership) {
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    userId: membership.userId,
    roleTemplate: membership.roleTemplate,
    status: membership.status,
    version: membership.version,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
  };
}

function toDomain(row: InvitationRow): Invitation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    inviteeEmail: row.inviteeEmail,
    roleTemplate: row.roleTemplate as RoleTemplate,
    status: row.status as InvitationStatus,
    codeHash: row.codeHash,
    invitedByUserId: row.invitedByUserId,
    branchId: row.branchId,
    departmentId: row.departmentId,
    expiresAt: row.expiresAt,
    acceptedByUserId: row.acceptedByUserId,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMembershipDomain(row: MembershipRow): Membership {
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
