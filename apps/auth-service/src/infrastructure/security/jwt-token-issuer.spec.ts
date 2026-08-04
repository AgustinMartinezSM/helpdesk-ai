import { JwtService } from '@nestjs/jwt';
import { JwtTokenIssuer } from './jwt-token-issuer';
import type { AccessTokenClaims } from '../../application/ports/token-issuer';

/**
 * The signed token, decoded.
 *
 * Every other test of the mint path asserts against `FakeTokenIssuer.lastClaims`
 * — what the session service HANDED to the issuer — which is a different
 * question from what the issuer put in the JWT. That gap hid a real defect for
 * four sprints: `SessionService` assembled a `tm` claim that this class never
 * copied, so team-scoped visibility denied for everybody while the fake-based
 * suite stayed green.
 *
 * TypeScript could not catch it either. The claims are added with
 * `...(condition && { tm })`, and a spread is not an object literal, so excess
 * property checking never fires — passing a field the interface does not
 * declare is silently legal.
 *
 * So this suite decodes. Anything that has to survive signing is asserted
 * here, on the real `JwtService`, and nowhere else is enough.
 */

const SECRET = 'jwt-test-secret-0123456789abcdef0123456789';
const TTL_SECONDS = 900;

const USER_ID = '11111111-1111-4111-8111-111111111111';
const ORGANIZATION_ID = '00000000-0000-4000-8000-000000000001';
const BRANCH = '00000000-0000-4000-8000-00000000000a';
const TEAM = '00000000-0000-4000-8000-00000000000c';

function build() {
  const jwt = new JwtService({ secret: SECRET });
  return { jwt, issuer: new JwtTokenIssuer(jwt, TTL_SECONDS) };
}

async function decode(
  claims: AccessTokenClaims,
): Promise<Record<string, unknown>> {
  const { jwt, issuer } = build();
  const { token } = await issuer.issueAccessToken(claims);
  return jwt.verifyAsync(token, { secret: SECRET });
}

const FULL: AccessTokenClaims = {
  sub: USER_ID,
  email: 'ada@example.com',
  org: ORGANIZATION_ID,
  perms: ['tickets.read_team'],
  mv: 3,
  br: [BRANCH],
  tm: [TEAM],
};

describe('JwtTokenIssuer', () => {
  it('signs every tenant claim it is given', async () => {
    const payload = await decode(FULL);

    expect(payload.sub).toBe(USER_ID);
    expect(payload.email).toBe('ada@example.com');
    expect(payload.org).toBe(ORGANIZATION_ID);
    expect(payload.perms).toEqual(['tickets.read_team']);
    expect(payload.mv).toBe(3);
    expect(payload.br).toEqual([BRANCH]);
    // The one this suite exists for. `tickets.read_team` reads `tm` and denies
    // on absence, so a dropped claim is not a missing field — it is a
    // permission that grants nothing.
    expect(payload.tm).toEqual([TEAM]);
  });

  it('carries every claim the session service can assemble', async () => {
    // A structural check beside the value checks above: whatever the mint path
    // builds has to arrive. Listing the names here is what makes the next
    // added claim fail loudly instead of vanishing the way `tm` did.
    const payload = await decode(FULL);

    for (const claim of ['org', 'perms', 'mv', 'br', 'tm']) {
      expect(Object.keys(payload)).toContain(claim);
    }
  });

  it.each(['org', 'perms', 'mv', 'br', 'tm'] as const)(
    'omits %s rather than signing an undefined',
    async (claim) => {
      // Omitted, never null: a verifier reads "absent" as "no tenant context"
      // without having to decide what a null organization means, and the
      // scoped claims deny on absence.
      const payload = await decode({ sub: USER_ID, email: 'ada@example.com' });

      expect(Object.keys(payload)).not.toContain(claim);
    },
  );

  it('never signs a roles claim', async () => {
    // Phase 8 removed it. The product's role names live on the user row and
    // travel in the session response, not in the token.
    const payload = await decode({
      ...FULL,
      roles: ['admin'],
    } as AccessTokenClaims);

    expect(Object.keys(payload)).not.toContain('roles');
  });

  it('reports the configured lifetime rather than reading it back', async () => {
    const { issuer } = build();

    const issued = await issuer.issueAccessToken(FULL);

    expect(issued.expiresInSeconds).toBe(TTL_SECONDS);
  });
});
