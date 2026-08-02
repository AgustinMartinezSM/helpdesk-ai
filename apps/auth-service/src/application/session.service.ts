import { randomUUID } from 'node:crypto';
import { TenantContextUnavailableError } from '../domain/errors';
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
export interface IssueSessionOptions {
  /**
   * Lifetime for the refresh credential, capped at the configured normal
   * TTL — a caller can only SHRINK a session, never stretch one. Two
   * callers use it: login passes the shared-workstation TTL when the
   * client declared the machine shared (a hint that reduces access is
   * trustworthy by direction), and rotation passes the window the
   * presented token was born with, so a session keeps the posture it was
   * created under for its whole life.
   */
  refreshTtlSeconds?: number;
}

export class SessionService {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokenIssuer: TokenIssuer,
    private readonly clock: Clock,
    private readonly refreshTtlSeconds: number,
    private readonly memberships?: MembershipResolver,
    private readonly logger?: SessionLogger,
  ) {}

  async issueSession(
    user: User,
    options: IssueSessionOptions = {},
  ): Promise<Session> {
    const membership = await this.resolveMembership(user.id);

    const { token: accessToken, expiresInSeconds } =
      await this.tokenIssuer.issueAccessToken({
        sub: user.id,
        email: user.email,
        ...(membership && {
          org: membership.organizationId,
          perms: membership.permissions,
          mv: membership.membershipVersion,
        }),
        // `br` only when the membership actually covers branches: an empty
        // set says nothing an absent claim does not — branch-scoped
        // visibility denies on absence either way — and omitting it keeps an
        // unscoped member's token identical to the ones minted before
        // branches existed.
        ...(membership &&
          membership.branchIds.length > 0 && {
            br: membership.branchIds,
          }),
      });

    const now = this.clock.now();
    const id = randomUUID();
    const secret = generateRefreshSecret();

    // min() is the only-shrink guarantee in one place: a misconfigured
    // shared TTL larger than the normal one, or a tampered rotation window,
    // still cannot produce a session longer than the configured maximum.
    const refreshTtlSeconds = Math.min(
      options.refreshTtlSeconds ?? this.refreshTtlSeconds,
      this.refreshTtlSeconds,
    );

    await this.refreshTokens.create({
      id,
      userId: user.id,
      tokenHash: hashRefreshSecret(secret),
      expiresAt: new Date(now.getTime() + refreshTtlSeconds * 1000),
      createdAt: now,
      revokedAt: null,
      replacedById: null,
    });

    return {
      accessToken,
      expiresInSeconds,
      refreshToken: composeRefreshToken(id, secret),
      refreshTokenId: id,
      // `roles` here is response data, not a claim: since phase 8 the token
      // carries none, but the web still renders the product's role names, so
      // they come from the user row — the only place they live now.
      user: { id: user.id, email: user.email, roles: [...user.roles] },
    };
  }

  /**
   * Resolves the tenant claims, and now refuses rather than guessing.
   *
   * Sprint 9.2 let a failure through, on the argument that no service read
   * the claims so failing closed protected nothing. That stopped being true
   * the moment the write paths started taking the organization from the
   * token: a tenant-less token now produces rows that belong to nobody, and
   * those are indistinguishable from rows deliberately left global.
   *
   * The distinction that matters is between two things a resolver can say:
   *
   * - **"This person belongs to no organization."** A real answer, and a
   *   token is still minted for it — with no tenant claims, so the caller can
   *   sign in, see nothing, and be refused by the write paths with a reason.
   *   That state is ordinary: it is every account between registering and the
   *   consumer creating its membership.
   * - **"I could not ask."** Unreachable service, rejected credential, a body
   *   that did not parse. Nothing is known, so nothing is minted.
   *
   * `MembershipResolver` keeps those apart on purpose — null for the first,
   * a throw for the second — which is what makes this distinction possible
   * rather than a guess about what an error meant.
   */
  private async resolveMembership(userId: string) {
    if (!this.memberships) {
      return null;
    }
    try {
      return await this.memberships.resolveFor(userId);
    } catch (error) {
      this.logger?.error(
        `refusing to mint a token: tenant context unavailable (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      throw new TenantContextUnavailableError();
    }
  }
}
