import {
  HttpMembershipResolver,
  MembershipResolutionFailedError,
} from './http-membership-resolver';

const BASE_URL = 'http://localhost:3010';
const SERVICE_TOKEN = 'a'.repeat(48);
const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function resolverWith(fetchImpl: FakeFetch): HttpMembershipResolver {
  return new HttpMembershipResolver(
    BASE_URL,
    SERVICE_TOKEN,
    5_000,
    fetchImpl as unknown as typeof fetch,
  );
}

describe('HttpMembershipResolver', () => {
  it('presents the service credential and asks the internal endpoint', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const resolver = resolverWith(async (url, init) => {
      seenUrl = url;
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse({
        organizationId: ORGANIZATION_ID,
        permissions: [],
        membershipVersion: 2,
      });
    });

    const resolved = await resolver.resolveFor(USER_ID);

    expect(seenUrl).toBe(`${BASE_URL}/internal/memberships/${USER_ID}/active`);
    expect(seenHeaders['x-internal-service-token']).toBe(SERVICE_TOKEN);
    // The user credential must not be reused for a process credential, and
    // there is no caller token at mint time to send anyway.
    expect(seenHeaders['authorization']).toBeUndefined();
    expect(resolved).toEqual({
      organizationId: ORGANIZATION_ID,
      permissions: [],
      membershipVersion: 2,
    });
  });

  it('reads a user with no membership as null, not as a failure', async () => {
    const resolver = resolverWith(async () =>
      jsonResponse({
        organizationId: null,
        permissions: [],
        membershipVersion: null,
      }),
    );

    expect(await resolver.resolveFor(USER_ID)).toBeNull();
  });

  it('treats a rejected credential as a failure, not as "no membership"', async () => {
    const resolver = resolverWith(
      async () => new Response('', { status: 401 }),
    );

    // A misconfigured secret silently degrading every token to "no tenant"
    // is exactly the failure this distinction prevents.
    await expect(resolver.resolveFor(USER_ID)).rejects.toBeInstanceOf(
      MembershipResolutionFailedError,
    );
  });

  it('surfaces a transport failure as a resolution failure', async () => {
    const resolver = resolverWith(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3010');
    });

    await expect(resolver.resolveFor(USER_ID)).rejects.toThrow('ECONNREFUSED');
  });

  it('rejects a body that is not JSON', async () => {
    const resolver = resolverWith(
      async () => new Response('<html>gateway error</html>', { status: 200 }),
    );

    await expect(resolver.resolveFor(USER_ID)).rejects.toThrow('not JSON');
  });

  it('rejects a payload whose shape changed upstream', async () => {
    const resolver = resolverWith(async () =>
      jsonResponse({
        organizationId: ORGANIZATION_ID,
        membershipVersion: 'two',
      }),
    );

    // Parsed, not trusted: an undefined value must not reach a signed token.
    await expect(resolver.resolveFor(USER_ID)).rejects.toThrow(
      'unexpected payload',
    );
  });

  it('encodes the user id into the path', async () => {
    let seenUrl = '';
    const resolver = resolverWith(async (url) => {
      seenUrl = url;
      return jsonResponse({
        organizationId: null,
        permissions: [],
        membershipVersion: null,
      });
    });

    await resolver.resolveFor('a/../b');

    expect(seenUrl).toBe(`${BASE_URL}/internal/memberships/a%2F..%2Fb/active`);
  });
});
