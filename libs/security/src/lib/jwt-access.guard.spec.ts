import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import { JwtAccessGuard, type AccessTokenPayload } from './jwt-access.guard.js';

const claims: AccessTokenPayload = {
  sub: '2f9d3a34-9c1e-4c5a-8f68-1af6a1c1a111',
  email: 'ada@example.com',
  roles: ['user'],
};

interface TestRequest {
  headers: Record<string, string | undefined>;
  user?: AccessTokenPayload;
}

function contextFor(request: TestRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('JwtAccessGuard', () => {
  const verifyAsync = jest.fn();
  const guard = new JwtAccessGuard({ verifyAsync } as unknown as JwtService);

  beforeEach(() => {
    verifyAsync.mockReset();
  });

  it('rejects a request without an authorization header', async () => {
    await expect(
      guard.canActivate(contextFor({ headers: {} })),
    ).rejects.toThrow(UnauthorizedException);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a non-bearer authorization header', async () => {
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Basic abc' } }),
      ),
    ).rejects.toThrow(UnauthorizedException);
    expect(verifyAsync).not.toHaveBeenCalled();
  });

  it('rejects a bearer token that fails verification', async () => {
    verifyAsync.mockRejectedValueOnce(new Error('expired'));
    await expect(
      guard.canActivate(
        contextFor({ headers: { authorization: 'Bearer bad-token' } }),
      ),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('accepts a valid bearer token and attaches the claims', async () => {
    verifyAsync.mockResolvedValueOnce(claims);
    const request: TestRequest = {
      headers: { authorization: 'Bearer good-token' },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    expect(verifyAsync).toHaveBeenCalledWith('good-token');
    expect(request.user).toEqual(claims);
  });
});
