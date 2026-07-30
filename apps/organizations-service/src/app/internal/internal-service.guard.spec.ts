import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { OrganizationsServiceEnv } from '../../config/env';
import {
  INTERNAL_SERVICE_TOKEN_HEADER,
  InternalServiceGuard,
} from './internal-service.guard';

const EXPECTED = 'a'.repeat(48);

function contextWithHeaders(
  headers: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

function guard(): InternalServiceGuard {
  return new InternalServiceGuard({
    INTERNAL_SERVICE_TOKEN: EXPECTED,
  } as OrganizationsServiceEnv);
}

describe('InternalServiceGuard', () => {
  it('admits a caller presenting the configured token', () => {
    const context = contextWithHeaders({
      [INTERNAL_SERVICE_TOKEN_HEADER]: EXPECTED,
    });
    expect(guard().canActivate(context)).toBe(true);
  });

  it('rejects a missing header', () => {
    expect(() => guard().canActivate(contextWithHeaders({}))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects an empty token', () => {
    const context = contextWithHeaders({
      [INTERNAL_SERVICE_TOKEN_HEADER]: '',
    });
    expect(() => guard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a wrong token of the same length', () => {
    const context = contextWithHeaders({
      [INTERNAL_SERVICE_TOKEN_HEADER]: 'b'.repeat(EXPECTED.length),
    });
    expect(() => guard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it('rejects a prefix of the token rather than throwing on the length mismatch', () => {
    // timingSafeEqual throws on differing lengths; the guard must turn that
    // into a 401 instead of a 500 that leaks which branch it took.
    const context = contextWithHeaders({
      [INTERNAL_SERVICE_TOKEN_HEADER]: EXPECTED.slice(0, 10),
    });
    expect(() => guard().canActivate(context)).toThrow(UnauthorizedException);
  });

  it('does not accept a bearer authorization header instead', () => {
    // The person-facing credential must not open the process-facing door.
    const context = contextWithHeaders({
      authorization: `Bearer ${EXPECTED}`,
    });
    expect(() => guard().canActivate(context)).toThrow(UnauthorizedException);
  });
});
