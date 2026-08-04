import { randomUUID } from 'node:crypto';
import { TenantContextUnavailableError } from '../domain/errors';
import type { User } from '../domain/user';
import type { Clock } from './ports/clock';
import type {
  MembershipResolver,
  ResolvedMembership,
  SessionLogger,
} from './ports/membership-resolver';
import type { RefreshTokenRepository } from './ports/refresh-token.repository';
import type { TokenIssuer } from './ports/token-issuer';
import {
  composeRefreshToken,
  generateRefreshSecret,
  hashRefreshSecret,
} from './refresh-token.codec';

/**
 * Everything a caller gets that is derived from ONE membership: the signed
 * token and the echo of what it asserts.
 *
 * Split out from `Session` in Sprint 10.6 because switching organizations
 * produces exactly this and nothing more — a new access token, no new refresh
 * credential. The refresh family belongs to the person and is untouched by a
 * change of context, which is what keeps the shared-terminal born window and
 * reuse detection out of the switching path entirely (ADR 0025).
 */
export interface AccessSession {
  accessToken: string;
  /** Access token lifetime; clients should refresh before this elapses. */
  expiresInSeconds: number;
  /**
   * The same permission keys stamped into the token's `perms` claim, echoed
   * so a client can decide what to RENDER without decoding the token (ADR
   * 0020). It is a snapshot: stale as soon as the membership changes, for at
   * most the access token's lifetime. Hiding a control is never the
   * authorization — every refusal already lives in a use case.
   *
   * Empty for an account that belongs to no organization yet, which is a real
   * minted state (ADR 0014) and denies everything, exactly as an empty
   * `Actor.permissions` does.
   */
  permissions: string[];
  /** Active organization, or null for the belongs-nowhere state. */
  organizationId: string | null;
  /**
   * Display data from the user row, not an authorization signal. Nothing
   * branches on it since ADR 0020 deleted the client-side staff boolean; the
   * account page renders it.
   */
  user: { id: string; email: string; roles: string[] };
}

export interface Session extends AccessSession {
  /** Opaque `<id>.<secret>` credential; shown to the client exactly once. */
  refreshToken: string;
  /** Storage id of the refresh token, used to link rotations. */
  refreshTokenId: string;
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
 *
 * Sprint 10.6 did not reopen that. A person may now CHOOSE which organization
 * a token is minted for, and the choice is remembered outside this service —
 * so the row still describes a person's session and nothing here had to learn
 * about workspaces (ADR 0025).
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
  /**
   * The organization this session is being asked for, when the caller
   * remembers a choice (Sprint 10.6). A REQUEST, validated upstream against
   * the stored membership.
   *
   * If it cannot be honoured the mint FALLS BACK to the default rule instead
   * of refusing. That is the whole point: somebody removed from the
   * organization their client remembers must not be signed out of the
   * product, and "not that one" is an answer rather than the uncertainty
   * `TenantContextUnavailableError` exists for. The caller learns what
   * happened by reading `organizationId` off the session it got back.
   */
  requestedOrganizationId?: string;
}

export class SessionService {
  constructor(
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly tokenIssuer: TokenIssuer,
    private readonly clock: Clock,
    private readonly refreshTtlSeconds: number,
    /**
     * REQUIRED since Sprint 10.8. It was optional, and the branch that
     * handled its absence returned null — the resolver's word for "belongs to
     * no organization" — so a service wired without one silently claimed a
     * fact about every account instead of admitting it could not ask. The
     * type is what makes that unwritable now; the env schema is what makes it
     * undeployable.
     */
    private readonly memberships: MembershipResolver,
    private readonly logger?: SessionLogger,
  ) {}

  async issueSession(
    user: User,
    options: IssueSessionOptions = {},
  ): Promise<Session> {
    const membership = await this.resolveWithFallback(
      user.id,
      options.requestedOrganizationId,
    );
    const { accessToken, expiresInSeconds, permissions, organizationId } =
      await this.mint(user, membership);

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
      permissions,
      organizationId,
      user: { id: user.id, email: user.email, roles: [...user.roles] },
      refreshToken: composeRefreshToken(id, secret),
      refreshTokenId: id,
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
   *
   * There used to be a THIRD case here, and removing it in Sprint 10.8 is
   * what made the two above trustworthy: an unconfigured service returned
   * null, so "nobody ever gave me a credential" came out as "this person
   * belongs nowhere". Every account on that deployment got a tenant-less
   * token and every write was refused, from one warning at boot.
   */
  private async resolveMembership(userId: string, organizationId?: string) {
    try {
      return await this.memberships.resolveFor(userId, organizationId);
    } catch (error) {
      this.logger?.error(
        `refusing to mint a token: tenant context unavailable (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      throw new TenantContextUnavailableError();
    }
  }

  /**
   * The requested organization if it can be honoured, otherwise whatever the
   * default rule picks (Sprint 10.6, ADR 0025).
   *
   * The second call is not a retry of a failure — a failure throws and never
   * reaches here. It is the deliberate answer to "the organization you
   * remembered is not one you can act in any more", and falling back is what
   * stops a removed member being signed out of the whole product by a stale
   * client. The client discovers the substitution by reading `organizationId`
   * off the session, which is also what it needs in order to stop asking.
   */
  private async resolveWithFallback(userId: string, organizationId?: string) {
    if (!organizationId) {
      return this.resolveMembership(userId);
    }
    const requested = await this.resolveMembership(userId, organizationId);
    if (requested) {
      return requested;
    }
    this.logger?.warn(
      `requested organization ${organizationId} is not available to this account; falling back to the default`,
    );
    return this.resolveMembership(userId);
  }

  /**
   * Signs one membership into an access token, and echoes what it asserts.
   *
   * THE ONLY PLACE CLAIMS ARE ASSEMBLED. Both mint paths — a full session and
   * a bare organization switch — come through here, because `org`, `perms`,
   * `mv`, `br` and `tm` all describe a single membership row and a second
   * assembly site is how they would come to describe two. A token whose
   * organization is one tenant and whose permissions or team scope are
   * another's would pass every check downstream: the guard validates a
   * signature, every `actorOf` copies the claims verbatim, and nothing
   * compares `mv`.
   */
  private async mint(
    user: User,
    membership: ResolvedMembership | null,
  ): Promise<AccessSession> {
    const { token, expiresInSeconds } = await this.tokenIssuer.issueAccessToken(
      {
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
        // `tm` on the same terms as `br`: only when non-empty, because
        // team-scoped visibility denies on absence either way.
        ...(membership &&
          membership.teamIds.length > 0 && {
            tm: membership.teamIds,
          }),
      },
    );

    return {
      accessToken: token,
      expiresInSeconds,
      // Echoed from the SAME resolution that stamped the claims, not resolved
      // again (ADR 0020): one membership read decides both what the token
      // asserts and what the client may render, so the two cannot disagree
      // about the moment they describe.
      permissions: membership ? [...membership.permissions] : [],
      organizationId: membership?.organizationId ?? null,
      // `roles` here is response data, not a claim: since phase 8 the token
      // carries none, but the web still renders the product's role names, so
      // they come from the user row — the only place they live now.
      user: { id: user.id, email: user.email, roles: [...user.roles] },
    };
  }

  /**
   * Mints an access token for a DIFFERENT organization the person belongs to,
   * or answers null because they do not (Sprint 10.6, ADR 0025).
   *
   * No fallback here, unlike a refresh: somebody who explicitly asked to go
   * somewhere must be told they cannot, not quietly left where they were and
   * shown a screen that says otherwise.
   *
   * No refresh token either, and that is the shape of the decision. Switching
   * context is not starting a session — the refresh family belongs to the
   * person (ADR 0014) — so nothing here touches `refresh_tokens`, and the
   * shared-terminal born window and reuse detection stay entirely out of the
   * switching path.
   */
  async exchangeOrganization(
    user: User,
    organizationId: string,
  ): Promise<AccessSession | null> {
    const membership = await this.resolveMembership(user.id, organizationId);
    if (!membership) {
      return null;
    }
    return this.mint(user, membership);
  }
}
