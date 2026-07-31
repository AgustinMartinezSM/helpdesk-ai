import { grantsAccess } from '../../domain/membership';
import { permissionsForTemplate } from '../../domain/permissions';
import { isActive } from '../../domain/organization';
import type { MembershipRepository } from '../ports/membership.repository';
import type { BranchMembershipRepository } from '../ports/structure.repository';
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
}

/**
 * Answers "which organization is this person acting in, and with what",
 * for auth-service to stamp into a token it is about to sign (ADR 0014).
 *
 * Resolution happens here, once per mint, rather than per request: that is
 * what keeps the other services free of a synchronous dependency on this one.
 *
 * There is no organization selector yet, so the rule is the oldest active
 * membership in an active organization. When switching organizations becomes
 * a token exchange, this is where the requested organization gets validated
 * against the caller's memberships instead of being chosen for them.
 */
export class ResolveActiveMembershipUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly organizations: OrganizationRepository,
    private readonly branchMemberships: BranchMembershipRepository,
  ) {}

  async execute(userId: string): Promise<ResolvedMembership | null> {
    const candidates = await this.memberships.listByUser(userId);

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
      return {
        organizationId: membership.organizationId,
        permissions: [...permissionsForTemplate(membership.roleTemplate)],
        membershipVersion: membership.version,
        branchIds: await this.branchMemberships.listBranchIds(membership.id),
      };
    }

    return null;
  }
}
