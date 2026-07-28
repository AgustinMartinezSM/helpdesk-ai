import { randomUUID } from 'node:crypto';
import type { User } from '../domain/user';
import type { Clock } from './ports/clock';
import type { RefreshTokenRepository } from './ports/refresh-token.repository';
import type { TokenIssuer } from './ports/token-issuer';
import {
  composeRefreshToken,
  generateRefreshSecret,
  hashRefreshSecret,
} from './refresh-token.codec';

export interface Session {
  accessToken: string;
  /** Access token lifetime; clients should refresh before this elapses. */
  expiresInSeconds: number;
  /** Opaque `<id>.<secret>` credential; shown to the client exactly once. */
  refreshToken: string;
  /** Storage id of the refresh token, used to link rotations. */
  refreshTokenId: string;
  user: { id: string; email: string; roles: string[] };
}

/**
 * Issues a complete session (access + refresh pair) for a user.
 * Shared by login and refresh so both paths produce identical sessions.
 */
export class SessionService {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokenIssuer: TokenIssuer,
    private readonly clock: Clock,
    private readonly refreshTtlSeconds: number,
  ) {}

  async issueSession(user: User): Promise<Session> {
    const { token: accessToken, expiresInSeconds } =
      await this.tokenIssuer.issueAccessToken({
        sub: user.id,
        email: user.email,
        roles: user.roles,
      });

    const now = this.clock.now();
    const id = randomUUID();
    const secret = generateRefreshSecret();

    await this.refreshTokens.create({
      id,
      userId: user.id,
      tokenHash: hashRefreshSecret(secret),
      expiresAt: new Date(now.getTime() + this.refreshTtlSeconds * 1000),
      createdAt: now,
      revokedAt: null,
      replacedById: null,
    });

    return {
      accessToken,
      expiresInSeconds,
      refreshToken: composeRefreshToken(id, secret),
      refreshTokenId: id,
      user: { id: user.id, email: user.email, roles: [...user.roles] },
    };
  }
}
