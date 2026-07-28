import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

/** Claims carried by every access token minted by auth-service. */
export interface AccessTokenPayload {
  sub: string;
  email: string;
  roles: string[];
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
