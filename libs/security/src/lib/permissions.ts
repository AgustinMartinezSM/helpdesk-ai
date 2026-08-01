/**
 * The permission-key vocabulary services check against `Actor.permissions`
 * (ADR 0015). This file owns the KEYS — the shared language that travels in
 * the `perms` token claim. The mapping from role templates to these keys is
 * organizations-service's to own and evaluate (ADR 0013); it imports this
 * vocabulary so producer and checker cannot drift on spelling.
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
