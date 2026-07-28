import type { UserProfile } from '../../domain/user-profile';
import type { UserProfileRepository } from '../../application/ports/user-profile.repository';
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

  async upsert(profile: UserProfile): Promise<void> {
    const data = {
      email: profile.email,
      displayName: profile.displayName,
      roles: profile.roles,
      registeredAt: profile.registeredAt,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
    await this.prisma.userProfile.upsert({
      where: { userId: profile.userId },
      create: { userId: profile.userId, ...data },
      update: data,
    });
  }

  async list(): Promise<UserProfile[]> {
    const rows = await this.prisma.userProfile.findMany({
      orderBy: { displayName: 'asc' },
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: UserProfileRow): UserProfile {
  return {
    userId: row.userId,
    email: row.email,
    displayName: row.displayName,
    roles: [...row.roles],
    registeredAt: row.registeredAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
