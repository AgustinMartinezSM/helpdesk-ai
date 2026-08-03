import { grantsAccess } from '../../domain/membership';
import { permissionsForTemplate } from '../../domain/permissions';
import {
  BOOTSTRAP_ORGANIZATION_SLUG,
  isActive,
} from '../../domain/organization';
import type { MembershipRepository } from '../ports/membership.repository';
import type { BranchMembershipRepository } from '../ports/structure.repository';
import type { SupportTeamRepository } from '../ports/support-team.repository';
import type { OrganizationRepository } from '../ports/organization.repository';

export interface ResolvedMembership {
  organizationId: string;
  /**
   * Permission keys for this person in that organization.
   *
   * Resolved from the role template by the code map in
   * src/domain/permissions.ts — the first increment of the evaluator
   * ADR 0015 asks for. The seeded template rows it ultimately wants are
   * still pending on the vocabulary questions in the handoff; when they
   * land, the map becomes a database read and this claim does not change
   * shape.
   */
  permissions: string[];
  /** Value of the `mv` claim (ADR 0014). */
  membershipVersion: number;
  /**
   * Branch ids this membership covers, minted as the `br` claim next to
   * `perms` (Sprint 9.5, D2). Always present, possibly empty — auth-service
   * parses exactly this name and shape, so both are FROZEN.
   *
   * Archived branches are INCLUDED: a manager keeps seeing the history of a
   * store that closed. Archival hides a branch from pickers, never from the
   * people who covered it.
   */
  branchIds: string[];
  /**
   * Support team ids this membership ACTIVELY belongs to, minted as the `tm`
   * claim (Sprint 9.12, ADR 0022). Always present, possibly empty — same
   * frozen shape as `branchIds` for the same reason.
   *
   * Archived teams are EXCLUDED, which is the one place this differs from
   * `branchIds`: a branch is a place and its history stays visible to whoever
   * covered it, while a team is a working group and archiving one is how an
   * organization says it no longer works. The claim grants visibility, so it
   * has to stop.
   */
  teamIds: string[];
}

/**
 * Answers "which organization is this person acting in, and with what",
 * for auth-service to stamp into a token it is about to sign (ADR 0014).
 *
 * Resolution happens here, once per mint, rather than per request: that is
 * what keeps the other services free of a synchronous dependency on this one.
 *
 * There is no organization selector yet, so the rule is the oldest eligible
 * membership — with ONE exception, added in Sprint 9.8: a real organization
 * always beats the bootstrap one.
 *
 * The exception is not a preference, it is what makes invitations work.
 * Everyone who registers gets a bootstrap membership from the registration
 * consumer, so a person who signs up in order to accept an invitation holds
 * two memberships, and the bootstrap one is almost always older. Oldest-first
 * alone would hand them a token for the migration's holding pen and their
 * acceptance would be invisible — the feature would not demonstrate at all.
 *
 * Nothing is retired to achieve this. The bootstrap membership stays: it is
 * migration data, `deactivated` is terminal, and the real answer to "which
 * organization am I acting in" is the selector ADR 0014 already defers. This
 * is the smallest change that makes the common case right, and it is
 * deliberately a tiebreak rather than a filter — someone whose ONLY
 * membership is the bootstrap one still resolves to it.
 *
 * When switching organizations becomes a token exchange, this is where the
 * requested organization gets validated against the caller's memberships
 * instead of being chosen for them, and this tiebreak goes away with it.
 */
export class ResolveActiveMembershipUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly organizations: OrganizationRepository,
    private readonly branchMemberships: BranchMembershipRepository,
    private readonly teams: SupportTeamRepository,
  ) {}

  async execute(userId: string): Promise<ResolvedMembership | null> {
    const candidates = await this.memberships.listByUser(userId);

    let fallback: ResolvedMembership | null = null;
    for (const membership of candidates) {
      if (!grantsAccess(membership)) {
        continue;
      }
      const organization = await this.organizations.findById(
        membership.organizationId,
      );
      // A suspended organization grants nothing, whatever the membership says.
      if (!organization || !isActive(organization)) {
        continue;
      }

      const resolved: ResolvedMembership = {
        organizationId: membership.organizationId,
        permissions: [...permissionsForTemplate(membership.roleTemplate)],
        membershipVersion: membership.version,
        branchIds: await this.branchMemberships.listBranchIds(membership.id),
        teamIds: await this.teams.listActiveTeamIdsForMembership(membership.id),
      };

      if (organization.slug !== BOOTSTRAP_ORGANIZATION_SLUG) {
        // Candidates arrive oldest-first, so the first real organization is
        // also the oldest real one — the original rule, with the holding pen
        // skipped rather than a new ordering invented.
        return resolved;
      }
      fallback ??= resolved;
    }

    return fallback;
  }
}
