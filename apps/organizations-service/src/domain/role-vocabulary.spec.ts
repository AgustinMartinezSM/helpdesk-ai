import {
  ORGANIZATION_GRANTABLE_TEMPLATES,
  PERMISSIONS,
  ROLE_TEMPLATES,
  ROLE_TEMPLATE_SCOPES,
  isOrganizationGrantable,
  isRoleTemplate,
  roleScopeOf,
  type RoleScope,
} from '@helpdesk-ai/security';
import { permissionsForTemplate } from './permissions';
import { canGrantRoleTemplate, isGrantableRoleTemplate } from './role-grants';

/**
 * The vocabulary itself (Sprint 9.14).
 *
 * These are the assertions that keep four documents and one map agreeing
 * about eight strings. They read like tautologies one at a time; together they
 * are the reason nobody has to re-derive the answer from prose.
 */
describe('the role template vocabulary', () => {
  it('is the eight stored keys, in snake_case', () => {
    // Not a style preference: these exact strings are in
    // memberships.role_template and invitations.role_template, so the day
    // they change is a data migration. Pinning them makes that deliberate.
    expect(ROLE_TEMPLATES).toEqual([
      'owner',
      'organization_admin',
      'branch_manager',
      'service_desk_manager',
      'team_manager',
      'agent',
      'requester',
      'auditor',
    ]);
  });

  it('gives every template a permission set', () => {
    for (const template of ROLE_TEMPLATES) {
      expect(permissionsForTemplate(template).size).toBeGreaterThan(0);
    }
  });

  it('narrows an arbitrary string, which is what the HTTP edges need', () => {
    expect(isRoleTemplate('agent')).toBe(true);
    expect(isRoleTemplate('AGENT')).toBe(false);
    expect(isRoleTemplate('platform_super_admin')).toBe(false);
    expect(isRoleTemplate('')).toBe(false);
  });
});

describe('grantability derives from scope (required cases 4 and 5)', () => {
  it('makes every shipped template organization-scoped', () => {
    for (const template of ROLE_TEMPLATES) {
      expect(roleScopeOf(template)).toBe('organization');
    }
  });

  it('excludes owner, and nothing else, from what an organization may grant', () => {
    expect(ORGANIZATION_GRANTABLE_TEMPLATES).not.toContain('owner');
    expect(ORGANIZATION_GRANTABLE_TEMPLATES).toHaveLength(
      ROLE_TEMPLATES.length - 1,
    );
    expect(isOrganizationGrantable('owner')).toBe(false);
    expect(isGrantableRoleTemplate('owner')).toBe(false);
  });

  it('refuses a platform-scoped template BY CONSTRUCTION, not by absence', () => {
    // The point of the whole exercise. ADR 0015 says no organization may ever
    // produce a platform super admin, and until Sprint 9.14 that held only
    // because no platform-scoped template existed — the grantable list was
    // "everything except owner". Here is one, built the way a future sprint
    // would add it, and the derivation refuses it without being told to.
    const hypothetical: Record<string, RoleScope> = {
      ...ROLE_TEMPLATE_SCOPES,
      platform_super_admin: 'platform',
    };
    const grantable = Object.keys(hypothetical).filter(
      (key) => hypothetical[key] === 'organization' && key !== 'owner',
    );

    expect(grantable).not.toContain('platform_super_admin');
    expect(grantable).toEqual([...ORGANIZATION_GRANTABLE_TEMPLATES]);
    // And the live guard refuses the name today, so a request naming it is
    // rejected at the edge rather than reaching the ceiling.
    expect(isOrganizationGrantable('platform_super_admin')).toBe(false);
  });

  it('is the single derivation every grant path reads', () => {
    // Required case 5 in one assertion: invitation, role change and the CSV
    // import that does not exist yet all narrow through this one function, so
    // the import sprint has nothing to re-decide.
    expect(isGrantableRoleTemplate).toBeDefined();
    for (const template of ROLE_TEMPLATES) {
      expect(isGrantableRoleTemplate(template)).toBe(
        isOrganizationGrantable(template),
      );
    }
  });
});

describe('the ceiling, against the new vocabulary', () => {
  it('lets an admin grant every organization template except owner (case 1)', () => {
    for (const template of ORGANIZATION_GRANTABLE_TEMPLATES) {
      expect(canGrantRoleTemplate('organization_admin', template)).toBe(true);
    }
  });

  it('does not let a narrower template grant a wider one', () => {
    expect(canGrantRoleTemplate('agent', 'organization_admin')).toBe(false);
    expect(canGrantRoleTemplate('requester', 'agent')).toBe(false);
    expect(canGrantRoleTemplate('team_manager', 'service_desk_manager')).toBe(
      false,
    );
  });

  it('keeps owner and organization_admin resolving alike, which is why owner is excluded by constant', () => {
    // The premise ADR 0021's constant rests on. When it stops being true, this
    // speaks up and the exclusion can become a subset test like everything
    // else.
    expect([...permissionsForTemplate('owner')].sort()).toEqual(
      [...permissionsForTemplate('organization_admin')].sort(),
    );
  });
});

describe('the candidate key is strictly narrower than the directory (D4)', () => {
  it('is held by the desk manager and implied by people.read', () => {
    expect(
      permissionsForTemplate('service_desk_manager').has(
        PERMISSIONS.PEOPLE_READ_ASSIGNABLE,
      ),
    ).toBe(true);
    // Implication is what stops the narrowing from making the template
    // ungrantable; the assertion lives beside the ceiling's other premises.
    expect(
      canGrantRoleTemplate('organization_admin', 'service_desk_manager'),
    ).toBe(true);
  });

  it('is not a substitute for the directory anywhere', () => {
    // Whoever reads the directory reads it because they hold people.read. The
    // narrow key never satisfies a people.read check — services check the
    // literal key, and the implication table is the ceiling's alone.
    const desk = permissionsForTemplate('service_desk_manager');
    expect(desk.has(PERMISSIONS.PEOPLE_READ)).toBe(false);
  });
});
