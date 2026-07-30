import { timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { APP_ENV, type OrganizationsServiceEnv } from '../../config/env';

export const INTERNAL_SERVICE_TOKEN_HEADER = 'x-internal-service-token';

interface InternalRequest {
  headers: Record<string, string | undefined>;
}

/**
 * Authenticates a calling service, not a person.
 *
 * auth-service has to resolve a membership while minting a token, which is
 * precisely the moment when no user token exists yet — so the pattern used
 * everywhere else in the platform (forward the caller's own bearer token,
 * ADR 0011) has nothing to forward. This is the first service credential in
 * the repository.
 *
 * It is a shared secret rather than a self-signed JWT on purpose: reusing
 * JWT_ACCESS_SECRET would make one symmetric key stand for both "this person
 * is authenticated" and "this process is authenticated", so rotating either
 * meaning would force rotating the other.
 *
 * Not built yet, and it should be before this credential guards anything a
 * person would miss: rotation, and an audit record of internal calls.
 * ADR 0011 named both as the story a service credential deserves.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: OrganizationsServiceEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    const presented = request.headers[INTERNAL_SERVICE_TOKEN_HEADER];

    if (!presented || !matches(presented, this.env.INTERNAL_SERVICE_TOKEN)) {
      throw new UnauthorizedException();
    }

    return true;
  }
}

/**
 * Constant-time comparison. The length check leaks only the length, which a
 * caller controls anyway; timingSafeEqual throws on a length mismatch, so it
 * cannot be the whole comparison.
 */
function matches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
