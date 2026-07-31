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
  PERMISSIONS.TICKETS_ASSIGN_SELF,
  PERMISSIONS.TICKETS_REPLY_PUBLIC,
  PERMISSIONS.TICKETS_NOTE_INTERNAL,
  PERMISSIONS.TICKETS_CHANGE_STATUS,
]);

/**
 * Both desk and team managers are the branch-manager set plus assigning
 * others; the matrix distinguishes them only through team- and queue-scoped
 * keys that have no feature to check them yet.
 */
const DESK_AND_TEAM_MANAGER_PERMISSIONS: ReadonlySet<string> = new Set([
  ...BRANCH_MANAGER_PERMISSIONS,
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
  PERMISSIONS.PEOPLE_READ,
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
