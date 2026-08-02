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
 * meaning would force rotating the other. That argument survives Sprint 9.8
 * declaring JWT_ACCESS_SECRET here for the public surface: the two variables
 * mean different things and neither opens the other's routes.
 *
 * ROTATION, from Sprint 9.8: the guard accepts the value being rotated out
 * (INTERNAL_SERVICE_TOKEN_PREVIOUS) alongside the current one, so a rotation
 * is add-promote-drop rather than a synchronized restart of every caller. The
 * runbook is in SECURITY.md.
 *
 * STILL NOT BUILT, deliberately: an audit record of internal calls. Recording
 * WHICH process called requires the credential to identify the caller —
 * per-caller secrets, or a signed service assertion. Attaching a
 * self-declared caller header to a shared secret would log a claim the
 * credential does not bind, which is decoration rather than attribution.
 * ADR 0011 named both halves; this closes one of them.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: OrganizationsServiceEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    const presented = request.headers[INTERNAL_SERVICE_TOKEN_HEADER];

    if (!presented || !this.accepts(presented)) {
      throw new UnauthorizedException();
    }

    return true;
  }

  /**
   * Both comparisons always run — no early return on the first match. An
   * early return would make "matched the current value" measurably faster
   * than "matched the previous one", which is a timing signal about which
   * half of a rotation a caller is on.
   */
  private accepts(presented: string): boolean {
    const current = matches(presented, this.env.INTERNAL_SERVICE_TOKEN);
    const previous = this.env.INTERNAL_SERVICE_TOKEN_PREVIOUS
      ? matches(presented, this.env.INTERNAL_SERVICE_TOKEN_PREVIOUS)
      : false;
    return current || previous;
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
