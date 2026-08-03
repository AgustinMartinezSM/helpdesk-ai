import type {
  PersonProfilePatch,
  UserProfile,
} from '../../domain/user-profile';
import type {
  DirectoryEntry,
  UserProfileRepository,
} from '../../application/ports/user-profile.repository';
import type { UserProfile as UserProfileRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaUserProfileRepository implements UserProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string): Promise<UserProfile | null> {
    const row = await this.prisma.userProfile.findUnique({
      where: { userId },
    });
    return row ? toDomain(row) : null;
  }

  async findMember(
    organizationId: string,
    userId: string,
  ): Promise<UserProfile | null> {
    // Membership first, from the local projection (ADR 0014). A foreign
    // user, an inactive member and a nonexistent one all produce the same
    // null — confirming existence is the leak.
    const membership = await this.prisma.directoryMembership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
    });
    if (!membership || membership.status !== 'active') {
      return null;
    }
    return this.findByUserId(userId);
  }

  async upsert(profile: UserProfile): Promise<void> {
    // The update arm writes ONLY the identity seed (ADR 0018): user_profiles
    // is a hybrid, and a replayed registration event must never overwrite
    // the API-owned profile columns — displayName included. The create arm
    // writes the full row, profile columns as the caller seeded them.
    await this.prisma.userProfile.upsert({
      where: { userId: profile.userId },
      create: {
        userId: profile.userId,
        email: profile.email,
        displayName: profile.displayName,
        preferredName: profile.preferredName,
        phone: profile.phone,
        language: profile.language,
        timezone: profile.timezone,
        registeredAt: profile.registeredAt,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      },
      update: {
        email: profile.email,
        registeredAt: profile.registeredAt,
        updatedAt: profile.updatedAt,
      },
    });
  }

  async updateProfile(
    userId: string,
    patch: PersonProfilePatch,
    updatedAt: Date,
  ): Promise<void> {
    // Only the keys present in the patch reach the UPDATE — undefined
    // spreads to nothing — so a person edit can never touch the identity
    // seed and never resets a column the caller did not name.
    await this.prisma.userProfile.update({
      where: { userId },
      data: {
        ...(patch.displayName !== undefined
          ? { displayName: patch.displayName }
          : {}),
        ...(patch.preferredName !== undefined
          ? { preferredName: patch.preferredName }
          : {}),
        ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
        ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
        updatedAt,
      },
    });
  }

  async list(
    organizationId: string,
    statuses: readonly string[] = ['active'],
  ): Promise<DirectoryEntry[]> {
    // Two queries in the same database, not a cross-service join: the
    // membership projection lives in helpdesk_users precisely so this read
    // needs no call to organizations-service (ADR 0014).
    const members = await this.prisma.directoryMembership.findMany({
      where: { organizationId, status: { in: [...statuses] } },
      select: { userId: true, roleTemplate: true, status: true },
    });
    const rows = await this.prisma.userProfile.findMany({
      where: { userId: { in: members.map((member) => member.userId) } },
      orderBy: { displayName: 'asc' },
    });
    // The role and status come from the projection this query already reads
    // — the directory can say who is an admin, and who is suspended, without
    // a second service call.
    const byUser = new Map(members.map((member) => [member.userId, member]));
    return rows.map((row) => ({
      profile: toDomain(row),
      roleTemplate: byUser.get(row.userId)?.roleTemplate ?? 'requester',
      status: byUser.get(row.userId)?.status ?? 'active',
    }));
  }
}

function toDomain(row: UserProfileRow): UserProfile {
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    preferredName: row.preferredName,
    phone: row.phone,
    language: row.language,
    timezone: row.timezone,
    registeredAt: row.registeredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
