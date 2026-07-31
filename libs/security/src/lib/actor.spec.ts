import {
  hasPermission,
  NoOrganizationContextError,
  requireOrganization,
} from './actor.js';
import { PERMISSIONS } from './permissions.js';

describe('hasPermission', () => {
  it('grants exactly what the token carried', () => {
    const actor = {
      id: 'a',
      permissions: new Set([PERMISSIONS.TICKETS_READ_ALL]),
    };

    expect(hasPermission(actor, PERMISSIONS.TICKETS_READ_ALL)).toBe(true);
    expect(hasPermission(actor, PERMISSIONS.AUDIT_READ)).toBe(false);
  });

  it('denies on an empty set', () => {
    // The shape of a token whose perms claim was absent: actorOf turns the
    // missing claim into an empty set, so an old token loses capabilities
    // rather than gaining them. An absent SET is no longer expressible —
    // permissions is required, and that is the compile-time point of phase 8.
    expect(
      hasPermission(
        { id: 'a', permissions: new Set() },
        PERMISSIONS.ORGANIZATION_READ,
      ),
    ).toBe(false);
  });
});

describe('requireOrganization', () => {
  it('returns the organization the actor is acting in', () => {
    expect(
      requireOrganization({
        id: 'a',
        organizationId: 'org-1',
        permissions: new Set(),
      }),
    ).toBe('org-1');
  });

  it('refuses an actor with no organization', () => {
    // The state of every account between registering and
    // organizations-service consuming the registration event.
    expect(() =>
      requireOrganization({ id: 'a', permissions: new Set() }),
    ).toThrow(NoOrganizationContextError);
  });
});
