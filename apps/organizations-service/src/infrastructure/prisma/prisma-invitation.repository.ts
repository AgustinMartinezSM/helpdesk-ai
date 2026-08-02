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
