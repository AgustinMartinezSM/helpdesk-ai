import type { RefreshTokenRepository } from '../../application/ports/refresh-token.repository';
import type { RefreshToken } from '../../domain/refresh-token';
import type { PrismaService } from './prisma.service';

export class PrismaRefreshTokenRepository implements RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string): Promise<RefreshToken | null> {
    const row = await this.prisma.refreshToken.findUnique({ where: { id } });
    return row ?? null;
  }

  async create(token: RefreshToken): Promise<void> {
    await this.prisma.refreshToken.create({
      data: {
        id: token.id,
        userId: token.userId,
        tokenHash: token.tokenHash,
        expiresAt: token.expiresAt,
        createdAt: token.createdAt,
        revokedAt: token.revokedAt,
        replacedById: token.replacedById,
      },
    });
  }

  async revoke(
    id: string,
    revokedAt: Date,
    replacedById?: string,
  ): Promise<void> {
    // updateMany + revokedAt: null keeps the FIRST revocation timestamp if
    // two requests race; a second revoke is a no-op.
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt, replacedById: replacedById ?? null },
    });
  }

  async revokeAllForUser(userId: string, revokedAt: Date): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt },
    });
  }
}
