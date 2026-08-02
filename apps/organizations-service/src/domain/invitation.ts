import { permissionsForTemplate } from './permissions';
import { ROLE_TEMPLATES, type RoleTemplate } from './membership';

/**
 * An invitation is a redeemable offer of membership, not a credential for an
 * account. It opens no session, cannot be presented at login, and grants
 * nothing on its own: redeeming it requires being authenticated as the
 * addressed person (Sprint 9.8, D6). The person's own password is created by
 * them, through registration, and the issuing admin never sees it — which is
 * how this avoids the permanent shared password ADR 0016 forbids.
 */
export const INVITATION_STATUSES = ['pending', 'accepted', 'revoked'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/**
 * Seven days, as a domain constant rather than configuration.
 *
 * Expiry is a security window, and a security window with two sources of
 * truth drifts — the same argument that keeps BOOTSTRAP_ORGANIZATION_SLUG a
 * constant. Nothing sweeps expired rows: the repository has no scheduler, no
 * cron and no job runner, so `expired` is DERIVED at read time rather than
 * stored. A stored status would lie from the moment it came due until
 * something nobody built got around to writing it.
 */
export const INVITATION_TTL_HOURS = 168;

export interface Invitation {
  readonly id: string;
  readonly organizationId: string;
  /** Normalized at the boundary; the addressee is matched against it. */
  readonly inviteeEmail: string;
  readonly roleTemplate: RoleTemplate;
  readonly status: InvitationStatus;
  /** sha256 of the code's secret half. The code itself is never stored. */
  readonly codeHash: string;
  readonly invitedByUserId: string;
  readonly expiresAt: Date;
  readonly acceptedByUserId: string | null;
  readonly acceptedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export function isExpired(invitation: Invitation, now: Date): boolean {
  return invitation.expiresAt.getTime() <= now.getTime();
}

export function expiresAtFrom(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + INVITATION_TTL_HOURS * 3_600_000);
}

/**
 * Email is compared case-insensitively and trimmed, here and nowhere else.
 *
 * This normalizes for MATCHING an addressee, and deliberately does nothing
 * clever — no dot-stripping, no plus-tag removal. Those are provider-specific
 * rules, and applying them would make two addresses the product treats as
 * different resolve to the same invitation.
 */
export function normalizeInviteeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Templates an invitation may name.
 *
 * `owner` is excluded outright rather than left to the subset check below,
 * and the reason is in the map it would be checked against: TEMPLATE_PERMISSIONS
 * resolves `owner` and `organization_admin` to the same set today, so a subset
 * test alone would happily let an organization admin mint a peer at the top
 * template. Two mechanisms, because one of them is currently blind.
 */
export const INVITABLE_ROLE_TEMPLATES = ROLE_TEMPLATES.filter(
  (template) => template !== 'owner',
);

export function isInvitableRoleTemplate(value: string): value is RoleTemplate {
  return (INVITABLE_ROLE_TEMPLATES as readonly string[]).includes(value);
}

/**
 * Whether an issuer holding `issuerTemplate` may hand out `requested`.
 *
 * Privilege must not travel upward: an invitation cannot grant a permission
 * its issuer does not hold, or `people.invite` would be a self-promotion key.
 * The comparison is over resolved permission SETS rather than a template
 * ranking, because the templates are not ordered — a branch manager and an
 * agent hold overlapping but incomparable sets, and inventing a hierarchy
 * would encode a claim ADR 0015 never made.
 *
 * Callers must read `issuerTemplate` from the stored membership, not from the
 * token: access tokens live JWT_ACCESS_TTL_SECONDS (900 by default), so a
 * demoted admin's claims outlive their authority by a quarter of an hour.
 */
export function canGrantRoleTemplate(
  issuerTemplate: RoleTemplate,
  requested: RoleTemplate,
): boolean {
  const issuer = permissionsForTemplate(issuerTemplate);
  for (const permission of permissionsForTemplate(requested)) {
    if (!issuer.has(permission)) {
      return false;
    }
  }
  return true;
}
