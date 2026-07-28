import type { RefreshToken } from '../../domain/refresh-token';

export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');

export interface RefreshTokenRepository {
  findById(id: string): Promise<RefreshToken | null>;
  create(token: RefreshToken): Promise<void>;
  revoke(id: string, revokedAt: Date, replacedById?: string): Promise<void>;
  /** Revokes every active token of the user (reuse-detection response). */
  revokeAllForUser(userId: string, revokedAt: Date): Promise<void>;
}
