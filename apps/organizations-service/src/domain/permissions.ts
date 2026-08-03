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
 * Desk and team managers are not a spread of the branch-manager set: their
 * reach is team-shaped, and inheriting `tickets.read_branch` would promise
 * branch semantics the matrix never gave them.
 *
 * Until Sprint 9.12 that left them with no read at all beyond their own
 * tickets, which was the sharpest hole in the map — `tickets.assign_agent`
 * without the ability to list what they were assigning. Support teams gave
 * `read_team` something to check (ADR 0022).
 */
const DESK_AND_TEAM_MANAGER_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.TICKETS_CREATE,
  PERMISSIONS.TICKETS_READ_OWN,
  // Sprint 9.12 closed the hole this comment used to describe: both
  // templates held `tickets.assign_agent` with no read beyond their own
  // tickets, so they could assign work they could not list. `read_team` is
  // the matrix's ● cell for them and it finally has a call site.
  PERMISSIONS.TICKETS_READ_TEAM,
  PERMISSIONS.TICKETS_ASSIGN_SELF,
  PERMISSIONS.TICKETS_REPLY_PUBLIC,
  PERMISSIONS.TICKETS_NOTE_INTERNAL,
  PERMISSIONS.TICKETS_CHANGE_STATUS,
  PERMISSIONS.TICKETS_ASSIGN_AGENT,
]);

/**
 * The service desk manager runs the teams and decides which one owns a
 * ticket; the team manager does neither, per the matrix (`teams.manage` is ○
 * for them — their own team only — and own-scope has no representation in a
 * flat set, the same call the last two sprints made).
 *
 * The last two keys are what Sprint 9.13 needed to make `teams.manage` usable
 * through the product rather than through a bearer token:
 *
 * `branches.read` is a matrix ● cell for this template that had no call site
 * until the branch-coverage editor. A team's reach is a set of branches, and
 * an editor that may not read them can only offer identifiers.
 *
 * `people.read` is the THIRD marked interim widening in this file, and it is
 * a widening rather than a matrix cell: the matrix grants it ○, own scope
 * only. A member picker cannot work from own scope by construction — it exists
 * to add somebody who is NOT in the team yet — and own-scope still has no
 * representation in a flat set of strings. So the flat key goes in, marked,
 * and it shrinks when the scope-qualifier vocabulary lands. The narrower
 * alternative was a picker that takes user ids, which is an operator interface
 * wearing a product's clothes (the argument Sprint 9.11 made for stations).
 */
const SERVICE_DESK_MANAGER_PERMISSIONS: ReadonlySet<string> = new Set([
  ...DESK_AND_TEAM_MANAGER_PERMISSIONS,
  PERMISSIONS.TEAMS_MANAGE,
  PERMISSIONS.ROUTING_MANAGE,
  PERMISSIONS.BRANCHES_READ,
  PERMISSIONS.PEOPLE_READ,
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
  // Matrix ● cell. Inert while they hold read_all, which Sprint 9.12 did
  // NOT take away: shrinking agents needs a rule for organizations with no
  // teams, and that is a product decision (9.12, D4).
  PERMISSIONS.TICKETS_READ_TEAM,
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
  // Sprint 9.11. Matrix ● cells for owner and admin. branches.update also
  // carries a ○ for branch_manager — editing their OWN branches — which stays
  // unrepresented for the reason the other ○ cells do: own-scope has no
  // representation in a flat set of strings, and inventing one here would
  // quietly answer the scope-qualifier question ADR 0016 closed.
  PERMISSIONS.BRANCHES_CREATE,
  PERMISSIONS.BRANCHES_UPDATE,
  // Sprint 9.12, matrix ● cells. read_team is inert beside read_all and is
  // granted anyway so the map stays faithful rather than clever.
  PERMISSIONS.TEAMS_MANAGE,
  PERMISSIONS.ROUTING_MANAGE,
  PERMISSIONS.TICKETS_READ_TEAM,
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
  PERMISSIONS.TICKETS_READ_TEAM,
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
  service_desk_manager: SERVICE_DESK_MANAGER_PERMISSIONS,
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
