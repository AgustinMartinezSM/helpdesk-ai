import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/**
 * Claims carried by an access token minted by auth-service.
 *
 * No `roles` claim: that was the compatibility claim phase 8 owed, and it is
 * paid. Authorization reads `perms`; the product's role names live in
 * auth-service's user model and travel in its HTTP responses, not in the
 * token.
 *
 * The tenant claims stay optional — a token for an account that belongs to
 * no organization yet is a real minted state, so a reader must treat "no
 * organization" as a state to handle rather than an impossibility.
 */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  /** Active organization id (ADR 0014). */
  org?: string;
  /** Resolved permission keys for this person in that organization. */
  perms?: string[];
  /** Membership version; lets a caller detect a stale tenant snapshot. */
  mv?: number;
  /**
   * The branch ids the active membership covers, minted only when non-empty
   * (omitted otherwise, like the other tenant claims). Read by branch-scoped
   * visibility (`tickets.read_branch`).
   */
  br?: string[];
  /** Support team ids (Sprint 9.12). Absent when the person is in none. */
  tm?: string[];
}

interface AuthenticatedRequest {
  headers: Record<string, string | undefined>;
  user?: AccessTokenPayload;
}

const BEARER_PREFIX = 'Bearer ';

/**
 * Verifies access tokens signed by auth-service and attaches the claims to
 * req.user. The consuming service supplies the verification context by
 * registering JwtModule with the shared HS256 secret; this guard never
 * mints tokens.
 */
@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;

    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException();
    }

    try {
      request.user = await this.jwt.verifyAsync<AccessTokenPayload>(
        header.slice(BEARER_PREFIX.length),
      );
    } catch {
      throw new UnauthorizedException();
    }

    return true;
  }
}
