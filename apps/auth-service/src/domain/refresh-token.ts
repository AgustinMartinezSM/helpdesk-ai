/**
 * Server-side record of one refresh token.
 *
 * The client holds an opaque credential of the form `<id>.<secret>`. Only the
 * SHA-256 of the secret is stored, so a database leak does not yield usable
 * refresh tokens. Rotation: using a token revokes it and links its
 * replacement; using an ALREADY revoked token is treated as theft.
 */
export interface RefreshToken {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly revokedAt: Date | null;
  /** Set when rotation replaced this token; enables reuse detection. */
  readonly replacedById: string | null;
}

export function isRefreshTokenActive(token: RefreshToken, now: Date): boolean {
  return token.revokedAt === null && token.expiresAt.getTime() > now.getTime();
}
