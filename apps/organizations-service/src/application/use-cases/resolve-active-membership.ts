import { grantsAccess, type Membership } from '../../domain/membership';
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
 * ## Two paths, and the requested one wins
 *
 * Since Sprint 10.6 a caller may name the organization it wants (ADR 0025).
 * The request is validated here against the STORED membership and is honoured
 * only if the person actively belongs to an active organization by that id —
 * the id is a request, never a fact, which is what makes it safe for it to
 * have come from a browser at all.
 *
 * An unhonourable request answers `null`, exactly like "belongs nowhere". The
 * caller decides what that means: the exchange refuses, and a refresh carrying
 * a remembered choice falls back to the default path rather than signing
 * anybody out.
 *
 * ## The default path, when nothing was requested
 *
 * The rule is the oldest eligible membership — with ONE exception, added in
 * Sprint 9.8: a real organization always beats the bootstrap one.
 *
 * The exception is not a preference, it is what makes invitations work.
 * Everyone who registers gets a bootstrap membership from the registration
 * consumer, so a person who signs up in order to accept an invitation holds
 * two memberships, and the bootstrap one is almost always older. Oldest-first
 * alone would hand them a token for the migration's holding pen and their
 * acceptance would be invisible — the feature would not demonstrate at all.
 *
 * **This tiebreak is permanent, and the comment that used to sit here was
 * wrong to schedule its deletion for the selector's arrival.** A selector adds
 * a way to ask; it does not remove the need for an answer when nobody has
 * asked, and that is every login, forever — a person signing in on a new
 * device has expressed no choice. Deleting it would regress every invited
 * account back into the holding pen. It stays a tiebreak rather than a filter,
 * so someone whose ONLY membership is the bootstrap one still resolves to it.
 */
export class ResolveActiveMembershipUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly organizations: OrganizationRepository,
    private readonly branchMemberships: BranchMembershipRepository,
    private readonly teams: SupportTeamRepository,
  ) {}

  async execute(
    userId: string,
    requestedOrganizationId?: string,
  ): Promise<ResolvedMembership | null> {
    if (requestedOrganizationId) {
      return this.resolveRequested(userId, requestedOrganizationId);
    }
    return this.resolveDefault(userId);
  }

  /**
   * One lookup rather than a walk. The requested path is the one a switcher
   * hits on every refresh, and it is also the path whose candidate count grows
   * as people join more organizations, so it reads the row directly instead of
   * scanning every membership the person holds.
   *
   * The gates are deliberately the SAME two the default path applies, in the
   * same order: an inactive membership and a suspended organization must not
   * become reachable by asking for them by name.
   */
  private async resolveRequested(
    userId: string,
    organizationId: string,
  ): Promise<ResolvedMembership | null> {
    const membership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      userId,
    );
    if (!membership || !grantsAccess(membership)) {
      return null;
    }
    const organization = await this.organizations.findById(organizationId);
    if (!organization || !isActive(organization)) {
      return null;
    }
    return this.describe(membership);
  }

  private async resolveDefault(
    userId: string,
  ): Promise<ResolvedMembership | null> {
    const candidates = await this.memberships.listByUser(userId);

    // The bootstrap membership held back, so the walk can prefer any real
    // organization over it without re-ordering the candidates.
    let fallback: Membership | null = null;
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

      if (organization.slug !== BOOTSTRAP_ORGANIZATION_SLUG) {
        // Candidates arrive oldest-first, so the first real organization is
        // also the oldest real one — the original rule, with the holding pen
        // skipped rather than a new ordering invented.
        return this.describe(membership);
      }
      fallback ??= membership;
    }

    return fallback ? this.describe(fallback) : null;
  }

  /**
   * The claims for one membership, built in ONE place.
   *
   * Both paths go through here on purpose. `org`, `perms`, `mv`, `br` and `tm`
   * describe a single membership row, and a second assembly site is how they
   * would come to describe two — a token whose organization is one tenant and
   * whose permissions or team scope are another's. Nothing downstream could
   * detect that: the guard checks the signature, every `actorOf` copies the
   * claims verbatim, and nothing compares `mv`.
   */
  private async describe(membership: Membership): Promise<ResolvedMembership> {
    return {
      organizationId: membership.organizationId,
      permissions: [...permissionsForTemplate(membership.roleTemplate)],
      membershipVersion: membership.version,
      branchIds: await this.branchMemberships.listBranchIds(membership.id),
      teamIds: await this.teams.listActiveTeamIdsForMembership(membership.id),
    };
  }
}
