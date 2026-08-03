/**
 * An organization is the tenant boundary every other row in the platform
 * will eventually belong to (ADR 0012).
 */
export const ORGANIZATION_STATUSES = ['active', 'suspended'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export interface Organization {
  readonly id: string;
  /** Stable, human-readable key. Unique across the platform. */
  readonly slug: string;
  readonly name: string;
  readonly status: OrganizationStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The organization every pre-migration row belongs to. It is created by the
 * initial migration rather than by application code, because both a local
 * database and a CI database have to end up with it and `prisma migrate
 * deploy` is the only provisioning path that runs in both.
 *
 * The slug is a constant rather than configuration on purpose: two sources
 * of truth for "which organization is the fallback" is exactly the kind of
 * drift that makes a recovery anchor stop anchoring. The migration plan
 * requires this organization to never be deleted.
 */
export const BOOTSTRAP_ORGANIZATION_SLUG = 'bootstrap';

export function isActive(organization: Organization): boolean {
  return organization.status === 'active';
}

/** An organization's display name, as far as the domain constrains it. */
export const ORGANIZATION_NAME_MAX_LENGTH = 80;

/**
 * Derives a slug from a display name.
 *
 * The caller never supplies one. That is a security decision rather than a
 * convenience: a caller-chosen slug that could be refused for being taken
 * would answer "does an organization by this name exist?" to anybody with an
 * account, and Sprint 9.9 established that the invitation preview is the only
 * public place an organization's name is exposed. So collisions are resolved
 * silently by the caller of this function, and nothing is ever reported as
 * unavailable.
 *
 * Normalisation is deliberately aggressive — lowercase, accents folded,
 * anything that is not a letter or digit collapsed to a single hyphen. The
 * slug column is a case-sensitive unique index with no CHECK constraint, so
 * every guarantee about its shape has to be made here, before the insert.
 */
export function slugFromName(name: string): string {
  const slug = name
    .normalize('NFD')
    // Strip combining marks, so "Ñandú" and "Nandu" cannot become two slugs
    // that look identical in a URL. Written as escapes rather than as the
    // characters themselves: a literal combining mark in source is invisible
    // to a reviewer and `no-irregular-whitespace` has caught this class of
    // thing here before (Sprint 9.15's byte-order mark).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');

  // A name made entirely of characters that do not survive normalisation —
  // "文文文", "!!!" — would otherwise produce an empty slug and violate the
  // unique index in a way the caller cannot understand.
  return slug || 'org';
}

/**
 * Slugs application code must never mint.
 *
 * `bootstrap` is not a matter of tidiness. The bootstrap migration inserts
 * with `ON CONFLICT ("id") DO NOTHING` — the conflict target is the id, not
 * the slug — so a row that already holds slug `bootstrap` under a different
 * id makes `prisma migrate deploy` fail on the unique index. That is a
 * provisioning failure on every future environment, not a bad row.
 *
 * And the comparison that decides whether an organization is the holding pen
 * is a plain `!==` against this constant, so anything that normalises to it
 * has to be refused before the insert rather than sorted out afterwards.
 */
const RESERVED_SLUGS = new Set([BOOTSTRAP_ORGANIZATION_SLUG]);

export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug);
}
