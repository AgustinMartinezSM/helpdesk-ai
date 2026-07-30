export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');

export interface AccessTokenClaims {
  /** User id (JWT `sub`). */
  sub: string;
  email: string;
  roles: string[];
  /**
   * Tenant context (ADR 0014). Optional because a user with no membership
   * still gets a token: every account that predates organizations-service is
   * in that state until the backfill runs, and refusing to sign for them
   * would break login for a claim nothing reads yet.
   *
   * `roles` stays alongside `perms` as a compatibility claim and is removed
   * once every call site reads permissions instead.
   */
  org?: string;
  perms?: string[];
  /** Membership version; lets a caller detect a stale tenant snapshot. */
  mv?: number;
}

export interface IssuedAccessToken {
  token: string;
  expiresInSeconds: number;
}

export interface TokenIssuer {
  issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken>;
}
