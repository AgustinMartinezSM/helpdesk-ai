/**
 * A support team is the operational group responsible for RESOLVING a ticket
 * (ADR 0022).
 *
 * It is not a department. A department is the requester's organizational area
 * and belongs to exactly one branch; a team is organization-owned, and its
 * branch reach is a separate relationship. That separation is the whole point
 * of this file: one central IT team serving every store, one payroll team
 * serving the organization, a regional team over several branches and a
 * branch-local team are all the same kind of row with different scope.
 */
export const SUPPORT_TEAM_STATUSES = ['active', 'archived'] as const;
export type SupportTeamStatus = (typeof SUPPORT_TEAM_STATUSES)[number];

export interface SupportTeam {
  readonly id: string;
  readonly organizationId: string;
  /** Stable operator-facing key, unique per organization, immutable. */
  readonly code: string;
  readonly name: string;
  readonly status: SupportTeamStatus;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * A team's branch reach, as the domain sees it.
 *
 * AN EMPTY SET MEANS ORGANIZATION-WIDE. That is the one rule everything else
 * here depends on: absence is the meaning, not a missing configuration, so a
 * team nobody has scoped serves every branch rather than none.
 */
export interface SupportTeamScope {
  readonly teamId: string;
  readonly branchIds: readonly string[];
}

export function isOrganizationWide(scope: SupportTeamScope): boolean {
  return scope.branchIds.length === 0;
}

/**
 * Whether a ticket filed under `branchId` may be handled by a team with this
 * scope.
 *
 * A branchless ticket is refused by a scoped team on purpose: there is no
 * branch to prove is in reach, and assigning it anyway would put work in front
 * of people the scope exists to keep it away from. An organization-wide team
 * takes it, because it takes everything.
 */
export function scopeCoversBranch(
  scope: SupportTeamScope,
  branchId: string | null,
): boolean {
  if (isOrganizationWide(scope)) {
    return true;
  }
  return branchId !== null && scope.branchIds.includes(branchId);
}

export function grantsSupport(team: SupportTeam): boolean {
  return team.status === 'active';
}
