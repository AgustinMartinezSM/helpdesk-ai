/**
 * A membership is the edge that answers "does this person belong here", and
 * with which role template. It is the substrate every authorization decision
 * reads (ADR 0015).
 */
import {
  OWNER_ROLE_TEMPLATE,
  ROLE_TEMPLATES,
  type RoleTemplate,
} from '@helpdesk-ai/security';

export const MEMBERSHIP_STATUSES = [
  'invited',
  'active',
  'suspended',
  'deactivated',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * The template vocabulary moved to `@helpdesk-ai/security` in Sprint 9.14 and
 * is re-exported here so the many call sites in this service keep their
 * import. It lives there for the reason the permission keys do: the browser
 * and this service were each declaring their own list, and two lists agreeing
 * by coincidence is a drift waiting to happen.
 *
 * What did NOT move is the mapping from a template to permissions. That is the
 * evaluator, and ADR 0013 keeps it here.
 */
export { OWNER_ROLE_TEMPLATE, ROLE_TEMPLATES, type RoleTemplate };

/**
 * The template ownership hands to the person it leaves behind.
 *
 * A transfer demotes the previous owner rather than removing them (ADR 0024).
 * `organization_admin` is the answer because it is the only template that keeps
 * every permission they were exercising a moment earlier: owner and admin
 * resolve to the same set, so nothing they had open stops working mid-session,
 * and an organization does not silently lose an administrator because somebody
 * handed over the top of it.
 */
export const SUCCEEDED_OWNER_ROLE_TEMPLATE: RoleTemplate = 'organization_admin';

export interface Membership {
  readonly id: string;
  readonly organizationId: string;
  /** Issued by auth-service; a plain id, never a foreign key (ADR 0003). */
  readonly userId: string;
  readonly roleTemplate: RoleTemplate;
  readonly status: MembershipStatus;
  /** Carried as the `mv` claim so a caller can detect a stale token. */
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Maps the global role array auth-service issues today onto a role template.
 *
 * This exists because roles are currently platform-wide with no scope
 * (ADR 0015), and the migration has to turn each existing user into a member
 * of the bootstrap organization without inventing a privilege they did not
 * already have. The operational backfill applies the same three rules, so a
 * user reconciled by hand and a user projected from an event land on the
 * same template.
 *
 * It is deliberately not the long-term mechanism: once memberships can be
 * managed through the product, the template is chosen by a person, not
 * derived from a legacy column.
 */
export function roleTemplateFromGlobalRoles(roles: string[]): RoleTemplate {
  if (roles.includes('admin')) {
    return 'organization_admin';
  }
  if (roles.includes('agent')) {
    return 'agent';
  }
  return 'requester';
}

export function grantsAccess(membership: Membership): boolean {
  return membership.status === 'active';
}

/**
 * Allowed status transitions, as data so a spec can walk every edge.
 *
 * There are no self-loops: "suspend an already-suspended member" means the
 * caller's picture of the row is stale, and confirming it with a success
 * would keep it stale. Refusing forces a re-read — and avoids a version bump
 * that would invalidate every outstanding token over a non-change.
 *
 * `deactivated` was terminal until Sprint 9.10, on the argument that "no way
 * back" is the recoverable default because a new membership can always be
 * created deliberately. That argument had a false premise:
 * @@unique([organizationId, userId]) means there is no second row to create,
 * and redemption inserts with skipDuplicates — so a removed person who
 * accepted a fresh invitation was told they had joined and stayed
 * deactivated. Removal was permanent, and nothing said so.
 *
 * The other half of the argument was that reactivation would restore access
 * silently. That was true of the operator endpoint it was written about, and
 * is not true of what replaced it: reinstating now takes a person's token, a
 * permission key, a confirmation and a published event (ADR 0021).
 */
export const MEMBERSHIP_STATUS_TRANSITIONS: Readonly<
  Record<MembershipStatus, readonly MembershipStatus[]>
> = {
  invited: ['active', 'deactivated'],
  active: ['suspended', 'deactivated'],
  suspended: ['active', 'deactivated'],
  deactivated: ['active'],
};

export function canTransitionMembershipStatus(
  from: MembershipStatus,
  to: MembershipStatus,
): boolean {
  return MEMBERSHIP_STATUS_TRANSITIONS[from].includes(to);
}
