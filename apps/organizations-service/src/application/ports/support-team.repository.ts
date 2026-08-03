import type { SupportTeam, SupportTeamStatus } from '../../domain/support-team';

export const SUPPORT_TEAM_REPOSITORY = Symbol('SUPPORT_TEAM_REPOSITORY');

export interface UpdateSupportTeamChanges {
  name?: string;
  status?: SupportTeamStatus;
}

/**
 * Persistence for support teams (Sprint 9.12, ADR 0022).
 *
 * Every read is scoped by organization ON THE PORT, the rule the structure
 * ports already follow: a foreign team and a nonexistent one must be
 * indistinguishable at this boundary, so no method exists that could fetch a
 * team without saying whose it is. That is what makes "organization A cannot
 * reference organization B's team" a property of the port rather than of each
 * caller remembering.
 */
export interface SupportTeamRepository {
  /** Null when (organizationId, code) is already taken. */
  create(team: SupportTeam): Promise<SupportTeam | null>;
  findByOrganizationAndId(
    organizationId: string,
    teamId: string,
  ): Promise<SupportTeam | null>;
  /** Every team of one organization, ordered by name, archived included. */
  list(organizationId: string): Promise<SupportTeam[]>;
  update(
    teamId: string,
    changes: UpdateSupportTeamChanges,
    at: Date,
  ): Promise<SupportTeam>;

  /**
   * Replaces the team's whole member set. A replace rather than a pair of
   * verbs for the reason the branch editor gave: the caller's intent is a
   * set, and repeating the request converges.
   */
  setMembers(teamId: string, membershipIds: string[], at: Date): Promise<void>;
  /** Membership ids in the team. */
  listMemberIds(teamId: string): Promise<string[]>;
  /**
   * Team ids one membership actively belongs to, ARCHIVED TEAMS EXCLUDED.
   *
   * This is what the `tm` claim is minted from, so an archived team must not
   * appear: the claim grants visibility, and a team nobody works any more
   * should stop granting it. Contrast `br`, which keeps archived branches
   * because a manager keeps the history of a store that closed — a branch is
   * a place, a team is a working group.
   */
  listActiveTeamIdsForMembership(membershipId: string): Promise<string[]>;

  /** Replaces the team's branch scope. Empty means organization-wide. */
  setBranchScope(teamId: string, branchIds: string[], at: Date): Promise<void>;
  listBranchIds(teamId: string): Promise<string[]>;
}
