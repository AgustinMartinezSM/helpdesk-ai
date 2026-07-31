import {
  HttpMembershipVerifier,
  MembershipVerificationFailedError,
} from './http-membership-verifier';

const BASE_URL = 'http://localhost:3010';
const SERVICE_TOKEN = 'a'.repeat(48);
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '11111111-1111-4111-8111-111111111111';

type FakeFetch = (url: string, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The full payload the real endpoint returns, not just the port's fields. */
function membershipBody(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: ORGANIZATION_ID,
    userId: USER_ID,
    status: 'active',
    roleTemplate: 'agent',
    permissions: ['tickets.assign_self'],
    membershipVersion: 2,
    organizationStatus: 'active',
    ...overrides,
  };
}

function verifierWith(fetchImpl: FakeFetch): HttpMembershipVerifier {
  return new HttpMembershipVerifier(
    BASE_URL,
    SERVICE_TOKEN,
    5_000,
    fetchImpl as unknown as typeof fetch,
  );
}

describe('HttpMembershipVerifier', () => {
  it('presents the service credential and asks the internal endpoint', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    const verifier = verifierWith(async (url, init) => {
      seenUrl = url;
      seenHeaders = (init?.headers ?? {}) as Record<string, string>;
      return jsonResponse(membershipBody());
    });

    const membership = await verifier.findInOrganization(
      ORGANIZATION_ID,
      USER_ID,
    );

    expect(seenUrl).toBe(
      `${BASE_URL}/internal/organizations/${ORGANIZATION_ID}/memberships/${USER_ID}`,
    );
    expect(seenHeaders['x-internal-service-token']).toBe(SERVICE_TOKEN);
    // The question is about a third party (the assignee), so the caller's
    // own credential would answer the wrong question — and must not travel.
    expect(seenHeaders['authorization']).toBeUndefined();
    // Extra fields the endpoint returns are tolerated and stripped: the
    // port's answer carries exactly what assignment decides on.
    expect(membership).toEqual({
      status: 'active',
      roleTemplate: 'agent',
      permissions: ['tickets.assign_self'],
      organizationStatus: 'active',
    });
  });

  it('reads a user with no membership row as null, not as a failure', async () => {
    const verifier = verifierWith(
      async () => new Response('', { status: 404 }),
    );

    expect(
      await verifier.findInOrganization(ORGANIZATION_ID, USER_ID),
    ).toBeNull();
  });

  it('treats a rejected credential as a failure, not as "not a member"', async () => {
    const verifier = verifierWith(
      async () => new Response('', { status: 401 }),
    );

    // A misconfigured secret silently refusing every assignee as a
    // non-member is exactly the failure this distinction prevents.
    await expect(
      verifier.findInOrganization(ORGANIZATION_ID, USER_ID),
    ).rejects.toBeInstanceOf(MembershipVerificationFailedError);
  });

  it('surfaces a transport failure as a verification failure', async () => {
    const verifier = verifierWith(async () => {
      throw new Error('connect ECONNREFUSED 127.0.0.1:3010');
    });

    await expect(
      verifier.findInOrganization(ORGANIZATION_ID, USER_ID),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('rejects a body that is not JSON', async () => {
    const verifier = verifierWith(
      async () => new Response('<html>gateway error</html>', { status: 200 }),
    );

    await expect(
      verifier.findInOrganization(ORGANIZATION_ID, USER_ID),
    ).rejects.toThrow('not JSON');
  });

  it('rejects a payload whose shape changed upstream', async () => {
    const verifier = verifierWith(async () =>
      jsonResponse(membershipBody({ permissions: 'tickets.assign_self' })),
    );

    // Parsed, not trusted: an undefined value must not decide who may hold
    // a ticket.
    await expect(
      verifier.findInOrganization(ORGANIZATION_ID, USER_ID),
    ).rejects.toThrow('unexpected payload');
  });

  it('encodes both ids into the path', async () => {
    let seenUrl = '';
    const verifier = verifierWith(async (url) => {
      seenUrl = url;
      return new Response('', { status: 404 });
    });

    await verifier.findInOrganization('a/../b', 'c/../d');

    expect(seenUrl).toBe(
      `${BASE_URL}/internal/organizations/a%2F..%2Fb/memberships/c%2F..%2Fd`,
    );
  });
});
