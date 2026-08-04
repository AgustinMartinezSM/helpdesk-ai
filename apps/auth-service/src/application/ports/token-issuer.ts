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
  /**
   * Branch ids the active membership covers. Minted only when non-empty —
   * an empty set says nothing an absent claim does not, and absence is what
   * branch-scoped visibility reads as "deny".
   */
  br?: string[];
  /**
   * Support team ids the active membership belongs to, on exactly the same
   * terms as `br` (Sprint 9.12, ADR 0022): minted only when non-empty,
   * because team-scoped visibility also denies on absence.
   *
   * THIS FIELD WAS MISSING UNTIL SPRINT 10.6, and its absence was the whole
   * defect: `SessionService` assembled the claim and `JwtTokenIssuer` had
   * nothing to copy it from, so `tickets.read_team` granted nothing for four
   * sprints. Adding a claim here is not optional bookkeeping — this interface
   * is the contract the issuer copies from, and a claim the mint path builds
   * without declaring here is a claim that is silently dropped.
   */
  tm?: string[];
}

export interface IssuedAccessToken {
  token: string;
  expiresInSeconds: number;
}

export interface TokenIssuer {
  issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken>;
}
