import type { JwtService } from '@nestjs/jwt';
import type {
  AccessTokenClaims,
  IssuedAccessToken,
  TokenIssuer,
} from '../../application/ports/token-issuer';

/**
 * Issues short-lived JWT access tokens. Secret, TTL and issuer come from the
 * module registration (validated environment); `sub` carries the user id.
 *
 * The tenant claims are omitted rather than sent as null when a membership
 * could not be resolved. A verifier can then treat "absent" as "no tenant
 * context" without having to decide what a null organization means, and the
 * tokens minted before this sprint stay indistinguishable from the ones
 * minted for a user who belongs nowhere yet.
 */
export class JwtTokenIssuer implements TokenIssuer {
  constructor(
    private readonly jwt: JwtService,
    private readonly ttlSeconds: number,
  ) {}

  async issueAccessToken(
    claims: AccessTokenClaims,
  ): Promise<IssuedAccessToken> {
    const token = await this.jwt.signAsync(
      {
        email: claims.email,
        ...(claims.org !== undefined && { org: claims.org }),
        ...(claims.perms !== undefined && { perms: claims.perms }),
        ...(claims.mv !== undefined && { mv: claims.mv }),
        ...(claims.br !== undefined && { br: claims.br }),
      },
      { subject: claims.sub },
    );
    return { token, expiresInSeconds: this.ttlSeconds };
  }
}
