export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');

export interface AccessTokenClaims {
  /** User id (JWT `sub`). */
  sub: string;
  email: string;
  /**
   * Tenant context (ADR 0014). Optional because a user with no membership
   * still gets a token: belonging nowhere is a real answer, and the write
   * paths downstream are what refuse it, with a reason.
   *
   * No `roles` here — phase 8 removed the compatibility claim once every
   * call site read permissions instead. The product's role names live on
   * the user row and travel in the session response, not in the token.
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
