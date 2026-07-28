export const TOKEN_ISSUER = Symbol('TOKEN_ISSUER');

export interface AccessTokenClaims {
  /** User id (JWT `sub`). */
  sub: string;
  email: string;
  roles: string[];
}

export interface IssuedAccessToken {
  token: string;
  expiresInSeconds: number;
}

export interface TokenIssuer {
  issueAccessToken(claims: AccessTokenClaims): Promise<IssuedAccessToken>;
}
