import {
  InvalidRefreshTokenError,
  RefreshTokenReuseError,
} from '../../domain/errors';
import type { Clock } from '../ports/clock';
import type { RefreshTokenRepository } from '../ports/refresh-token.repository';
import type { UserRepository } from '../ports/user.repository';
import {
  hashRefreshSecret,
  parseRefreshToken,
  refreshHashesMatch,
} from '../refresh-token.codec';
import type { Session } from '../session.service';
import { SessionService } from '../session.service';

export interface RefreshSessionInput {
  refreshToken: string;
  /**
   * Where the client remembers being (Sprint 10.6, ADR 0025). Validated at
   * mint time and quietly ignored if it cannot be honoured — a refresh is how
   * a session survives, and it must not be the thing that ends one because a
   * membership went away.
   */
  organizationId?: string;
}

export class RefreshSessionUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly sessions: SessionService,
    private readonly clock: Clock,
  ) {}

  async execute(input: RefreshSessionInput): Promise<Session> {
    const parsed = parseRefreshToken(input.refreshToken);
    if (!parsed) {
      throw new InvalidRefreshTokenError();
    }

    const stored = await this.refreshTokens.findById(parsed.id);
    if (
      !stored ||
      !refreshHashesMatch(stored.tokenHash, hashRefreshSecret(parsed.secret))
    ) {
      throw new InvalidRefreshTokenError();
    }

    const now = this.clock.now();

    if (stored.revokedAt !== null) {
      // A rotated-out token came back: replay or theft. Revoke every session
      // of the user so a stolen token family dies immediately.
      await this.refreshTokens.revokeAllForUser(stored.userId, now);
      throw new RefreshTokenReuseError();
    }

    if (stored.expiresAt.getTime() <= now.getTime()) {
      throw new InvalidRefreshTokenError();
    }

    const user = await this.users.findById(stored.userId);
    if (!user) {
      throw new InvalidRefreshTokenError();
    }

    // Issue first, then revoke the old token pointing at its replacement.
    // The replacement inherits the window the presented token was BORN
    // with (expiresAt - createdAt), not the configured TTL: a session
    // opened on a shared workstation stays short across every rotation,
    // and a normal session keeps exactly today's window. Deriving it from
    // the row means no posture column exists to drift.
    const bornWindowSeconds = Math.round(
      (stored.expiresAt.getTime() - stored.createdAt.getTime()) / 1000,
    );
    const session = await this.sessions.issueSession(user, {
      refreshTtlSeconds: bornWindowSeconds,
      requestedOrganizationId: input.organizationId,
    });
    await this.refreshTokens.revoke(stored.id, now, session.refreshTokenId);

    return session;
  }
}
