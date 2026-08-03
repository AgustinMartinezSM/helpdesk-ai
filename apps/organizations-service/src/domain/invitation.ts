import type { RoleTemplate } from './membership';

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
  /**
   * Where this person will work, carried from a CSV import (Sprint 9.15) and
   * applied at redemption in the same transaction that inserts the membership.
   *
   * Null for every invitation issued from the single-invitation form, and null
   * forever is legitimate — an organization that configured no branches has
   * nowhere to place anybody. Sprint 9.8 predicted this shape: branch_manager's
   * own-scope `people.invite` "needs the branch set on the invitation itself",
   * and this is that column arriving for a different caller.
   */
  readonly branchId: string | null;
  /**
   * The requester's organizational area, never a support team (ADR 0022), and
   * only meaningful inside `branchId` — `Department.branchId` is a required
   * foreign key, so an import refuses a department named without one.
   */
  readonly departmentId: string | null;
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

// The templates an invitation may name, the ceiling that bounds them and the
// `owner` exclusion all moved to `role-grants.ts` in Sprint 9.10, when
// changing an existing membership became the second caller. One name for one
// list: an invitation grants a template exactly as a role change does.
