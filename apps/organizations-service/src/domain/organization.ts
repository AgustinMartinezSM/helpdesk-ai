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
