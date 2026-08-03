/**
 * The role-template vocabulary: the stable keys a membership can carry, and
 * the scope each one lives at (Sprint 9.14).
 *
 * This file owns the KEYS and their SCOPE. It does not own the mapping from a
 * template to permissions — that is the evaluator, and ADR 0013 puts it in
 * organizations-service. The split is the one `permissions.ts` already makes,
 * and for the same reason: producer, checker and browser share one spelling,
 * while the decision about what a template MEANS stays with the service that
 * owns memberships.
 *
 * Like the permission vocabulary, this module has NO imports, so the browser
 * can read the keys without pulling a server framework into its bundle.
 *
 * ## Why these spellings
 *
 * Four conventions were in use before this sprint: lowercase prose in ADR
 * 0015, `SCREAMING_SNAKE` in the target-state role table, an abbreviated
 * `ORG_ADMIN` in the matrix columns, and this snake_case in the code. The code
 * won because it is the only one that is load-bearing: these exact strings are
 * stored in `memberships.role_template` and `invitations.role_template`, so
 * renaming them is a data migration paid for a cosmetic. The documents moved.
 */

/**
 * Where a template's authority lives.
 *
 * `organization` — granted by an organization, over that organization.
 * `platform` — operates the platform itself, across tenants.
 *
 * This distinction is what makes ADR 0015's first invariant enforceable. That
 * invariant ("a CSV import, a directory group or an organization admin must
 * never be able to produce a platform super admin") held until now by ACCIDENT:
 * no platform-scoped template existed, so the grantable set could not contain
 * one. Absence is not an invariant — the sprint that finally adds a platform
 * template is the least likely to remember to exclude it. Now the exclusion is
 * derived from this field, and a platform template is refused the moment it
 * exists.
 */
export const ROLE_SCOPES = ['organization', 'platform'] as const;
export type RoleScope = (typeof ROLE_SCOPES)[number];

/**
 * The templates that exist, with the scope each lives at.
 *
 * There is deliberately NO platform-scoped entry. The approved target state
 * names `PLATFORM_SUPER_ADMIN`, and adding it here with nothing behind it
 * would break the rule the permission vocabulary follows — only keys with a
 * real call site exist, because an unchecked key is a claim nothing can
 * falsify. What this sprint adds is the RULE that would refuse it, plus a test
 * that constructs one and watches it be refused. The row arrives with the
 * feature.
 */
export const ROLE_TEMPLATE_SCOPES = {
  owner: 'organization',
  organization_admin: 'organization',
  branch_manager: 'organization',
  service_desk_manager: 'organization',
  team_manager: 'organization',
  agent: 'organization',
  requester: 'organization',
  auditor: 'organization',
} as const satisfies Record<string, RoleScope>;

export type RoleTemplate = keyof typeof ROLE_TEMPLATE_SCOPES;

/** Declaration order is the product's order: widest authority first. */
export const ROLE_TEMPLATES = Object.keys(
  ROLE_TEMPLATE_SCOPES,
) as readonly RoleTemplate[];

/**
 * The template at the top of an organization, named rather than spelled out.
 *
 * It earns a constant because three separate mechanisms compare against it and
 * none of them is a grant: the exclusion below (nobody may hand it out),
 * organization creation (the first one is written directly — ADR 0023), and
 * ownership transfer (it moves between two rows in one transaction — ADR
 * 0024). A literal in three places that must agree is a literal that will one
 * day not.
 */
export const OWNER_ROLE_TEMPLATE: RoleTemplate = 'owner';

export function isRoleTemplate(value: string): value is RoleTemplate {
  return value in ROLE_TEMPLATE_SCOPES;
}

export function roleScopeOf(template: RoleTemplate): RoleScope {
  return ROLE_TEMPLATE_SCOPES[template];
}

/**
 * Templates an organization may hand out at all, before any per-actor ceiling.
 *
 * Two exclusions, and they are different in kind:
 *
 * - **Platform scope** — structural. An organization grants authority over
 *   itself; it cannot grant authority over the platform, whoever is asking.
 *   This is ADR 0015's invariant, now derived rather than assumed.
 * - **`owner`** — a specific decision (ADR 0021). It resolves to the same
 *   permission set as `organization_admin` today, so the per-actor subset
 *   check is blind exactly there: an admin could mint a peer at the top, or
 *   unseat the person already holding it. Two mechanisms, because one of them
 *   is currently blind.
 *
 * Every grant path reads this: invitations, role changes, and the CSV import.
 * That is the point — there was nothing for the import sprint to re-decide.
 *
 * **Two paths write `owner` and neither is a grant path**, which is why they do
 * not read this list and must never be "unified" with something that does.
 * Creation writes the first one (ADR 0023) and transfer moves it between two
 * rows of one organization in a single transaction (ADR 0024). A grant hands a
 * template out of this set to somebody; those two do something else, and
 * routing them through here would mean widening the set to make them fit.
 */
export const ORGANIZATION_GRANTABLE_TEMPLATES = ROLE_TEMPLATES.filter(
  (template) =>
    ROLE_TEMPLATE_SCOPES[template] === 'organization' &&
    template !== OWNER_ROLE_TEMPLATE,
);

/**
 * Whether a template may be granted by an organization at all.
 *
 * Takes a plain string on purpose: the callers are validating input that
 * arrived over HTTP or, later, out of a CSV cell, so the narrowing to
 * `RoleTemplate` is this function's job rather than its precondition.
 */
export function isOrganizationGrantable(value: string): value is RoleTemplate {
  return (ORGANIZATION_GRANTABLE_TEMPLATES as readonly string[]).includes(
    value,
  );
}
