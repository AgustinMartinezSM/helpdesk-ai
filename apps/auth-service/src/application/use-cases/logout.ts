import type { Clock } from '../ports/clock';
import type { RefreshTokenRepository } from '../ports/refresh-token.repository';
import {
  hashRefreshSecret,
  parseRefreshToken,
  refreshHashesMatch,
} from '../refresh-token.codec';

export interface LogoutInput {
  refreshToken: string;
}

/**
 * Revokes the presented refresh token. Idempotent by design: logging out
 * with a garbage, unknown or already-revoked token succeeds silently —
 * there is nothing useful to tell an attacker and nothing for a legitimate
 * client to recover from.
 */
export class LogoutUseCase {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: LogoutInput): Promise<void> {
    const parsed = parseRefreshToken(input.refreshToken);
    if (!parsed) {
      return;
    }

    const stored = await this.refreshTokens.findById(parsed.id);
    if (
      !stored ||
      !refreshHashesMatch(stored.tokenHash, hashRefreshSecret(parsed.secret)) ||
      stored.revokedAt !== null
    ) {
      return;
    }

    await this.refreshTokens.revoke(stored.id, this.clock.now());
  }
}
