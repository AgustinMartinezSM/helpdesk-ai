import {
  ORGANIZATION_GRANTABLE_TEMPLATES,
  PERMISSIONS,
  isOrganizationGrantable,
  type RoleTemplate,
} from '@helpdesk-ai/security';
import { permissionsForTemplate } from './permissions';

/**
 * The grant ceiling: which role templates a person may hand to somebody else,
 * whether by invitation (Sprint 9.8) or by changing an existing membership
 * (Sprint 9.10). It lived in `invitation.ts` while invitations were its only
 * caller; it moved here when the second one arrived, because a membership use
 * case importing from `invitation.ts` reads like a mistake.
 *
 * There are two gates, and Sprint 9.14 separated them because they answer
 * different questions:
 *
 * 1. **May an organization grant this template at all?** — scope, and the
 *    `owner` exclusion. Derived in `@helpdesk-ai/security` so every grant path
 *    reads one answer, including the CSV import that does not exist yet.
 * 2. **May THIS actor grant it?** — the permission subset below, per actor.
 *
 * A grant has to pass both.
 */

/**
 * Re-exported so the existing call sites keep their import. The list itself is
 * derived from each template's declared scope now, which is what makes ADR
 * 0015's platform invariant structural instead of accidental — see
 * `role-templates.ts` for why that mattered.
 */
export const GRANTABLE_ROLE_TEMPLATES = ORGANIZATION_GRANTABLE_TEMPLATES;

export function isGrantableRoleTemplate(value: string): value is RoleTemplate {
  return isOrganizationGrantable(value);
}

/**
 * Permissions whose reach contains another key's.
 *
 * This exists because the ceiling compares permission SETS, and a set
 * comparison does not know that one key can be strictly wider than another.
 * `tickets.read_all` returns every ticket in the organization —
 * ListTicketsUseCase checks it first and short-circuits — so a holder can see
 * everything `tickets.read_branch` would show. The map deliberately does not
 * grant admins `read_branch` (their reach is organization-wide, not
 * branch-shaped), and until Sprint 9.10 that deliberate choice made the
 * subset test refuse an admin inviting a branch manager: nobody could create
 * one through the product at all.
 *
 * USED BY THE CEILING ONLY. Services check the literal key an operation
 * needs, and this table must never become a shortcut for that — an actor
 * holding `tickets.read_all` does not thereby satisfy a check written against
 * `tickets.read_branch`, because the branch path also reads the `br` claim
 * and means something different by an empty set.
 *
 * Add a line when a new scoped read key lands. Nothing fails loudly if you
 * forget; the symptom is a grant that gets refused for no visible reason,
 * which is exactly how this one was found.
 */
const IMPLIED_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  [PERMISSIONS.TICKETS_READ_ALL]: [
    PERMISSIONS.TICKETS_READ_BRANCH,
    PERMISSIONS.TICKETS_READ_OWN,
  ],
  // Sprint 9.14, and the line this table's warning was written for. The
  // directory answers strictly more than the candidate list — same people,
  // more columns, plus the statuses the candidate list refuses — so an admin
  // holding `people.read` can grant a template that holds only
  // `people.read_assignable`. Without this line, giving the desk manager the
  // narrower key would have made that template ungrantable by anybody, which
  // is precisely the failure `tickets.read_branch` produced in Sprint 9.10.
  [PERMISSIONS.PEOPLE_READ]: [PERMISSIONS.PEOPLE_READ_ASSIGNABLE],
};

/**
 * The issuer's set plus everything their keys imply. Only the issuer's side
 * is expanded: the requested template's literal keys are what that membership
 * would actually carry, and widening them would compare against permissions
 * nobody is being granted.
 */
function effectiveReach(permissions: ReadonlySet<string>): ReadonlySet<string> {
  const reach = new Set(permissions);
  for (const permission of permissions) {
    for (const implied of IMPLIED_PERMISSIONS[permission] ?? []) {
      reach.add(implied);
    }
  }
  return reach;
}

/**
 * Whether an actor holding `actorTemplate` may hand out `requested`.
 *
 * Privilege must not travel upward: a grant cannot carry a permission its
 * granter does not hold, or `people.invite` and `people.assign_roles` would
 * both be self-promotion keys. The comparison is over resolved permission
 * SETS rather than a template ranking, because the templates are not ordered
 * — a branch manager and an agent hold overlapping but incomparable sets, and
 * inventing a hierarchy would encode a claim ADR 0015 never made.
 *
 * Callers must read `actorTemplate` from the stored membership, not from the
 * token: access tokens live JWT_ACCESS_TTL_SECONDS (900 by default), so a
 * demoted admin's claims outlive their authority by a quarter of an hour.
 */
export function canGrantRoleTemplate(
  actorTemplate: RoleTemplate,
  requested: RoleTemplate,
): boolean {
  const actor = effectiveReach(permissionsForTemplate(actorTemplate));
  for (const permission of permissionsForTemplate(requested)) {
    if (!actor.has(permission)) {
      return false;
    }
  }
  return true;
}
