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
      roles: ['agent'],
      permissions: new Set([PERMISSIONS.TICKETS_READ_ALL]),
    };

    expect(hasPermission(actor, PERMISSIONS.TICKETS_READ_ALL)).toBe(true);
    expect(hasPermission(actor, PERMISSIONS.AUDIT_READ)).toBe(false);
  });

  it('denies on an absent set — tokens minted before the perms claim', () => {
    // The safe direction: an old token must lose capabilities, not gain them.
    expect(
      hasPermission(
        { id: 'a', roles: ['agent'] },
        PERMISSIONS.TICKETS_READ_ALL,
      ),
    ).toBe(false);
  });

  it('denies on an empty set', () => {
    expect(
      hasPermission(
        { id: 'a', roles: [], permissions: new Set() },
        PERMISSIONS.ORGANIZATION_READ,
      ),
    ).toBe(false);
  });
});

describe('requireOrganization', () => {
  it('returns the organization the actor is acting in', () => {
    expect(
      requireOrganization({ id: 'a', roles: [], organizationId: 'org-1' }),
    ).toBe('org-1');
  });

  it('refuses an actor with no organization', () => {
    // The state of every account between registering and
    // organizations-service consuming the registration event.
    expect(() => requireOrganization({ id: 'a', roles: [] })).toThrow(
      NoOrganizationContextError,
    );
  });
});
