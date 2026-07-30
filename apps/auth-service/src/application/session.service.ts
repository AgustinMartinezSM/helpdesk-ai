import { randomUUID } from 'node:crypto';
import type { User } from '../domain/user';
import type { Clock } from './ports/clock';
import type {
  MembershipResolver,
  SessionLogger,
} from './ports/membership-resolver';
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
 * Shared by login and refresh so both paths produce identical sessions,
 * which is also why tenant resolution lives here rather than in either
 * use case: a token minted by refresh must carry the same claims as one
 * minted by login.
 *
 * A session belongs to a person, not to a workspace. `refresh_tokens` is
 * therefore keyed by user only, with no organization column, and the active
 * organization is chosen per access token. ADR 0014 left this open and leaned
 * this way; picking the alternative would have changed reuse-detection
 * semantics, since revoking a stolen token family would then have to reason
 * about which workspace the family belonged to.
 */
export class SessionService {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokenIssuer: TokenIssuer,
    private readonly clock: Clock,
    private readonly refreshTtlSeconds: number,
    private readonly memberships?: MembershipResolver,
    private readonly logger?: SessionLogger,
  ) {}

  async issueSession(user: User): Promise<Session> {
    const membership = await this.resolveMembership(user.id);

    const { token: accessToken, expiresInSeconds } =
      await this.tokenIssuer.issueAccessToken({
        sub: user.id,
        email: user.email,
        roles: user.roles,
        ...(membership && {
          org: membership.organizationId,
          perms: membership.permissions,
          mv: membership.membershipVersion,
        }),
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

  /**
   * Resolves the tenant claims, and lets a failure through.
   *
   * ADR 0014 accepts that auth-service gains a synchronous dependency on
   * organizations-service and says login fails when it is unavailable. That
   * becomes the right behaviour when the claims decide something. They do not
   * yet — no service reads them — so failing closed today would turn a new
   * service nobody depends on into a single point of failure for every login,
   * in exchange for protecting nothing.
   *
   * The warning is the point: a resolution that keeps failing has to be
   * visible before the enforcement phase makes it fatal. When write paths
   * start setting the organization from the claim, this must become a
   * refusal to mint.
   */
  private async resolveMembership(userId: string) {
    if (!this.memberships) {
      return null;
    }
    try {
      return await this.memberships.resolveFor(userId);
    } catch (error) {
      this.logger?.warn(
        `minting a token without tenant claims: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }
}
