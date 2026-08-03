/**
 * The permission-key vocabulary services check against `Actor.permissions`
 * (ADR 0015). This file owns the KEYS — the shared language that travels in
 * the `perms` token claim. The mapping from role templates to these keys is
 * organizations-service's to own and evaluate (ADR 0013); it imports this
 * vocabulary so producer and checker cannot drift on spelling.
 *
 * It has NO imports, deliberately, and is published as its own entry point
 * (`@helpdesk-ai/security/permissions`) so the browser can share the
 * vocabulary without pulling `JwtAccessGuard` — and NestJS with it — into a
 * client bundle. apps/web decides what to RENDER from these keys (ADR 0020);
 * it must never gain access to anything that decides.
 *
 * Only keys with a real server-side call site belong here. The approved
 * matrix in docs/architecture/tenancy-target-state.md names many more
 * (branches.*, teams.*, routing.*); they arrive with the features that
 * check them, because an unchecked key in a token is a claim nothing can
 * falsify.
 */
export const PERMISSIONS = {
  /** Present in every template: being a member means seeing the workspace. */
  ORGANIZATION_READ: 'organization.read',
  /**
   * Organization configuration — first call site: managing the
   * organization-defined profile field definitions.
   */
  ORGANIZATION_UPDATE: 'organization.update',
  /** The people directory. Listing profiles, not managing them. */
  PEOPLE_READ: 'people.read',
  /**
   * Editing someone else's profile values. Editing your own person-level
   * fields needs no key — being yourself is the authorization.
   */
  PEOPLE_UPDATE: 'people.update',
  /**
   * Bringing a person into the organization: issuing, listing and revoking
   * invitations. Redeeming one needs no key — holding the code while being
   * the addressed person is the authorization, and the invitee is by
   * definition not a member yet.
   *
   * An invitation cannot grant more than its issuer holds, so this key is
   * bounded by whatever else the issuer's template carries; the check lives
   * in the use case, against the stored membership rather than the token.
   */
  PEOPLE_INVITE: 'people.invite',
  /**
   * Moving a membership along the status transition table: suspend,
   * reinstate, and remove (which is a deactivation, never a deleted row —
   * ADR 0021).
   */
  PEOPLE_SUSPEND: 'people.suspend',
  /**
   * Changing which role template an existing membership carries. Separate
   * from PEOPLE_SUSPEND because the matrix separates them, and collapsing
   * the two would give everyone who can re-role somebody the power to lock
   * them out.
   *
   * Bounded by two ceilings in the use case, both read from stored rows:
   * the requested template and the target's current one must each be
   * grantable by the actor's own (ADR 0021).
   */
  PEOPLE_ASSIGN_ROLES: 'people.assign_roles',
  /** Listing the organization's branches. Reading structure, not editing it. */
  BRANCHES_READ: 'branches.read',
  /**
   * Which branches a membership covers — the edge that feeds the `br` claim
   * and with it `tickets.read_branch`. Creating and editing branches
   * themselves is a different act with no key here yet: that surface is
   * still operator-only.
   */
  BRANCHES_MANAGE_MEMBERS: 'branches.manage_members',
  TICKETS_CREATE: 'tickets.create',
  /** Own requests only; the requester's default visibility. */
  TICKETS_READ_OWN: 'tickets.read_own',
  /**
   * Every ticket in the organization. The team-scoped read
   * (`tickets.read_team`) replaces this for agents once teams exist; until
   * then this is the staff read.
   */
  TICKETS_READ_ALL: 'tickets.read_all',
  /**
   * Tickets of the branches the actor's membership covers, plus their own.
   * The branch set rides the `br` claim; an actor holding this key with an
   * empty set sees only their own requests — absence denies.
   */
  TICKETS_READ_BRANCH: 'tickets.read_branch',
  TICKETS_ASSIGN_SELF: 'tickets.assign_self',
  /** Assigning someone else, or unassigning. */
  TICKETS_ASSIGN_AGENT: 'tickets.assign_agent',
  TICKETS_REPLY_PUBLIC: 'tickets.reply_public',
  /**
   * Writing internal notes, and with it the internal staff workspace:
   * reading internal notes and using the AI suggestion tools, whose output
   * is derived from the full conversation a requester cannot see.
   */
  TICKETS_NOTE_INTERNAL: 'tickets.note_internal',
  TICKETS_CHANGE_STATUS: 'tickets.change_status',
  AUDIT_READ: 'audit.read',
  ANALYTICS_READ: 'analytics.read',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
