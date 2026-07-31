/**
 * A membership is the edge that answers "does this person belong here", and
 * with which role template. It is the substrate every authorization decision
 * will read once the permission evaluator exists (ADR 0015).
 */
export const MEMBERSHIP_STATUSES = [
  'invited',
  'active',
  'suspended',
  'deactivated',
] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/**
 * Role template keys. These are string values today, not seeded rows with
 * permission mappings — ADR 0015 wants rows, and they arrive with the
 * evaluator. Naming them here keeps the vocabulary in one place so the seed
 * migration, the consumer and the backfill cannot drift apart.
 *
 * Only three of these are reachable in this sprint; the rest exist because
 * ADR 0015 named them and a half-declared vocabulary invites invention at
 * the call site.
 */
export const ROLE_TEMPLATES = [
  'owner',
  'organization_admin',
  'branch_manager',
  'service_desk_manager',
  'team_manager',
  'agent',
  'requester',
  'auditor',
] as const;
export type RoleTemplate = (typeof ROLE_TEMPLATES)[number];

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
 * operator's picture of the row is stale, and confirming it with a success
 * would keep it stale. Refusing forces a re-read — and avoids a version bump
 * that would invalidate every outstanding token over a non-change.
 *
 * `deactivated` is terminal. Whether a deactivated member can be reinstated
 * — and with which role, after how long, decided by whom — is a product
 * decision deferred to the people-management sprint. Until it is made, "no
 * way back" is the recoverable default: a new membership can always be
 * created deliberately, while an accidental reactivation restores access
 * silently.
 */
export const MEMBERSHIP_STATUS_TRANSITIONS: Readonly<
  Record<MembershipStatus, readonly MembershipStatus[]>
> = {
  invited: ['active', 'deactivated'],
  active: ['suspended', 'deactivated'],
  suspended: ['active', 'deactivated'],
  deactivated: [],
};

export function canTransitionMembershipStatus(
  from: MembershipStatus,
  to: MembershipStatus,
): boolean {
  return MEMBERSHIP_STATUS_TRANSITIONS[from].includes(to);
}
