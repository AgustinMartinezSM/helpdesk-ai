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
    const session = await this.sessions.issueSession(user);
    await this.refreshTokens.revoke(stored.id, now, session.refreshTokenId);

    return session;
  }
}
