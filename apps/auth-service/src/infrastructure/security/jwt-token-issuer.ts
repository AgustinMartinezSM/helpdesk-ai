import type { JwtService } from '@nestjs/jwt';
import type {
  AccessTokenClaims,
  IssuedAccessToken,
  TokenIssuer,
} from '../../application/ports/token-issuer';

/**
 * Issues short-lived JWT access tokens. Secret, TTL and issuer come from the
 * module registration (validated environment); `sub` carries the user id.
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
      { email: claims.email, roles: claims.roles },
      { subject: claims.sub },
    );
    return { token, expiresInSeconds: this.ttlSeconds };
  }
}
