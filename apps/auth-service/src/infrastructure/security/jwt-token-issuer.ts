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
 *
 * EVERY CLAIM THE MINT PATH ASSEMBLES MUST BE COPIED HERE, and `tm` is the
 * reason that is worth saying: it was assembled in `SessionService` from
 * Sprint 9.12 and never copied, so `tickets.read_team` — which denies on an
 * absent claim — granted nothing at all until Sprint 10.6 found it. Nothing
 * failed: the fake issuer records what it was handed rather than what was
 * signed, and the consumers' tests hand-sign their own tokens. The regression
 * test for this decodes a real one.
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
        ...(claims.tm !== undefined && { tm: claims.tm }),
      },
      { subject: claims.sub },
    );
    return { token, expiresInSeconds: this.ttlSeconds };
  }
}
