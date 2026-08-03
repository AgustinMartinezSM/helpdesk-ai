import { timingSafeEqual } from 'node:crypto';
import {
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { APP_ENV, type TicketsServiceEnv } from '../../config/env';

export const INTERNAL_SERVICE_TOKEN_HEADER = 'x-internal-service-token';

interface InternalRequest {
  headers: Record<string, string | undefined>;
}

/**
 * Authenticates a calling process, not a person (Sprint 9.16).
 *
 * The second guard of this shape in the platform, and a deliberate copy rather
 * than a shared one: it reads THIS service's validated environment, and moving
 * it to `libs/security` would make a library depend on each service's env type
 * or on a looser one. Forty lines duplicated is cheaper than that coupling, and
 * the rules it encodes are stated in both places rather than assumed in one.
 *
 * Two rules carried over from organizations-service's guard, both load-bearing:
 *
 * - **Rotation is accepted**: `INTERNAL_SERVICE_TOKEN_PREVIOUS` is honoured
 *   alongside the current value, so a rotation is add-promote-drop rather than
 *   a synchronized restart of every caller (SECURITY.md has the runbook).
 * - **Both comparisons always run.** No early return on the first match: one
 *   would make "matched the current value" measurably faster than "matched the
 *   previous one", which is a timing signal about which half of a rotation the
 *   caller is on.
 *
 * Until this sprint, tickets-service only PRESENTED this credential (to verify
 * an assignee). It now also accepts it, on `/internal/projections/*` — which
 * the api-gateway does not route, and whose header the gateway strips from
 * every inbound request, so a browser has no path to it.
 */
@Injectable()
export class InternalServiceGuard implements CanActivate {
  constructor(@Inject(APP_ENV) private readonly env: TicketsServiceEnv) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<InternalRequest>();
    const presented = request.headers[INTERNAL_SERVICE_TOKEN_HEADER];

    // No configured credential means nothing can authenticate: a service
    // started without one must refuse rather than accept anybody, which is
    // the same fail-closed direction every other decision here takes.
    if (!presented || !this.env.INTERNAL_SERVICE_TOKEN) {
      throw new UnauthorizedException();
    }
    if (!this.accepts(presented, this.env.INTERNAL_SERVICE_TOKEN)) {
      throw new UnauthorizedException();
    }
    return true;
  }

  private accepts(presented: string, current: string): boolean {
    const matchesCurrent = matches(presented, current);
    const matchesPrevious = this.env.INTERNAL_SERVICE_TOKEN_PREVIOUS
      ? matches(presented, this.env.INTERNAL_SERVICE_TOKEN_PREVIOUS)
      : false;
    return matchesCurrent || matchesPrevious;
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
