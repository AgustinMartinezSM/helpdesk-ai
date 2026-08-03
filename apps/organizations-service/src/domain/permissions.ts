import { PERMISSIONS } from '@helpdesk-ai/security';
import type { RoleTemplate } from './membership';

/**
 * The template-to-permission map — the first increment of the evaluator
 * ADR 0015 asks for.
 *
 * Deliberately code, not seeded rows. ADR 0015 wants seeded template rows,
 * but the template vocabulary and the scope-qualifier representation are
 * still open questions (docs/handoffs/CURRENT-HANDOFF.md, "Decisions
 * pending"), and a seed migration would freeze answers nobody has given.
 * This map covers only implemented-feature keys — the keys the shared
 * vocabulary in @helpdesk-ai/security defines — and the seeding waits. When
 * the rows land, this file becomes a database read and no caller notices.
 */

const REQUESTER_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.TICKETS_CREATE,
  PERMISSIONS.TICKETS_READ_OWN,
]);

const BRANCH_MANAGER_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.TICKETS_CREATE,
  PERMISSIONS.TICKETS_READ_OWN,
  // The branch-scoped read (ADR 0015): visibility over the branches the
  // membership covers — the `br` claim supplies which ones — plus their own
  // tickets, and nothing organization-wide. First key in the map whose reach
  // depends on a claim beyond `perms` itself.
  PERMISSIONS.TICKETS_READ_BRANCH,
  PERMISSIONS.TICKETS_ASSIGN_SELF,
  PERMISSIONS.TICKETS_REPLY_PUBLIC,
  PERMISSIONS.TICKETS_NOTE_INTERNAL,
  PERMISSIONS.TICKETS_CHANGE_STATUS,
]);

/**
 * Desk and team managers are no longer a spread of the branch-manager set:
 * that shorthand ended the moment branch_manager gained a branch-scoped key.
 * Their reach is team- and queue-shaped in the matrix, and those keys have
 * no feature to check them yet — inheriting `tickets.read_branch` here would
 * silently promise branch semantics the matrix never gave them.
 */
const DESK_AND_TEAM_MANAGER_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.TICKETS_CREATE,
  PERMISSIONS.TICKETS_READ_OWN,
  PERMISSIONS.TICKETS_ASSIGN_SELF,
  PERMISSIONS.TICKETS_REPLY_PUBLIC,
  PERMISSIONS.TICKETS_NOTE_INTERNAL,
  PERMISSIONS.TICKETS_CHANGE_STATUS,
  PERMISSIONS.TICKETS_ASSIGN_AGENT,
]);

/**
 * Three of these grants — TICKETS_READ_ALL, TICKETS_ASSIGN_AGENT and the
 * flat PEOPLE_READ — are deliberate interim widenings of the approved matrix
 * (docs/architecture/tenancy-target-state.md): the matrix gives agents
 * team-scoped reads and no assign_agent, but teams do not exist yet, and
 * narrowing now would take away what staff can do today. The interim grants
 * shrink to the matrix when branches/teams arrive.
 */
const AGENT_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.PEOPLE_READ,
  PERMISSIONS.TICKETS_CREATE,
  PERMISSIONS.TICKETS_READ_OWN,
  PERMISSIONS.TICKETS_READ_ALL,
  PERMISSIONS.TICKETS_ASSIGN_SELF,
  PERMISSIONS.TICKETS_ASSIGN_AGENT,
  PERMISSIONS.TICKETS_REPLY_PUBLIC,
  PERMISSIONS.TICKETS_NOTE_INTERNAL,
  PERMISSIONS.TICKETS_CHANGE_STATUS,
]);

const ORGANIZATION_ADMIN_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSIONS.ORGANIZATION_READ,
  // First call sites in Sprint 9.6: managing the profile-field definitions
  // (organization.update) and editing someone else's values (people.update).
  // Matrix ● cells for owner and admin; branch_manager's own-scope
  // people.update stays unrepresented until branch-scoped editing means
  // something.
  PERMISSIONS.ORGANIZATION_UPDATE,
  PERMISSIONS.PEOPLE_READ,
  PERMISSIONS.PEOPLE_UPDATE,
  // Sprint 9.8. A matrix ● cell for owner and admin. branch_manager's ○
  // stays unrepresented: the matrix grants it own-scope, and a branch-scoped
  // invitation would have to mean "into my branches", which needs the branch
  // set on the invitation itself — a shape this sprint does not build.
  PERMISSIONS.PEOPLE_INVITE,
  // Sprint 9.10. Matrix ● cells for owner and admin, and blank for everyone
  // else — including branch_manager, which the matrix confirmed on review:
  // suspension is an organization-level act, and a store manager who needs it
  // gets ORGANIZATION_ADMIN, which is a visible grant rather than a quiet
  // widening of what every branch manager can do.
  PERMISSIONS.PEOPLE_SUSPEND,
  PERMISSIONS.PEOPLE_ASSIGN_ROLES,
  // The matrix gives branches.read to nearly every template and
  // branches.manage_members ○ to branch_manager. Both stay narrow here for
  // the reason people.invite's ○ cell has since 9.8: a branch-scoped grant
  // has to mean "within my branches", and no endpoint enforces that yet.
  PERMISSIONS.BRANCHES_READ,
  PERMISSIONS.BRANCHES_MANAGE_MEMBERS,
  PERMISSIONS.TICKETS_CREATE,
  PERMISSIONS.TICKETS_READ_OWN,
  PERMISSIONS.TICKETS_READ_ALL,
  PERMISSIONS.TICKETS_ASSIGN_SELF,
  PERMISSIONS.TICKETS_ASSIGN_AGENT,
  PERMISSIONS.TICKETS_REPLY_PUBLIC,
  PERMISSIONS.TICKETS_NOTE_INTERNAL,
  PERMISSIONS.TICKETS_CHANGE_STATUS,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.ANALYTICS_READ,
]);

/** Reads everything, writes nothing — including no ticket writes at all. */
const AUDITOR_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.PEOPLE_READ,
  PERMISSIONS.TICKETS_READ_OWN,
  PERMISSIONS.TICKETS_READ_ALL,
  PERMISSIONS.AUDIT_READ,
  PERMISSIONS.ANALYTICS_READ,
]);

const TEMPLATE_PERMISSIONS: Readonly<
  Record<RoleTemplate, ReadonlySet<string>>
> = {
  // Owner and admin differ in the matrix only on keys with no call site yet
  // (organization.delete, billing); until one exists they resolve alike.
  owner: ORGANIZATION_ADMIN_PERMISSIONS,
  organization_admin: ORGANIZATION_ADMIN_PERMISSIONS,
  branch_manager: BRANCH_MANAGER_PERMISSIONS,
  service_desk_manager: DESK_AND_TEAM_MANAGER_PERMISSIONS,
  team_manager: DESK_AND_TEAM_MANAGER_PERMISSIONS,
  agent: AGENT_PERMISSIONS,
  requester: REQUESTER_PERMISSIONS,
  auditor: AUDITOR_PERMISSIONS,
};

export function permissionsForTemplate(
  template: RoleTemplate,
): ReadonlySet<string> {
  return TEMPLATE_PERMISSIONS[template];
}
