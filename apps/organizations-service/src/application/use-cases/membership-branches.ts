import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import type { Branch } from '../../domain/branch';
import {
  BranchNotFoundError,
  ForbiddenMembershipActionError,
  MembershipNotFoundError,
} from '../../domain/errors';
import { requireAdministrableTarget } from '../membership-administration';
import type { MembershipRepository } from '../ports/membership.repository';
import type { Clock } from '../ports/organization.repository';
import type {
  BranchMembershipRepository,
  BranchRepository,
} from '../ports/structure.repository';

/**
 * Which branches a membership covers — the edge `tickets.read_branch` reads
 * through the `br` claim (Sprint 9.5, D2).
 *
 * Until Sprint 9.10 this was a PUT and a DELETE on the internal operator
 * surface, one request per branch, authenticated by a shared process
 * credential. It was the sharpest unattributable step left in onboarding: an
 * invited branch manager could only be given their branches by a caller no
 * person was behind (ADR 0016).
 */

export class ListBranchesUseCase {
  constructor(private readonly branches: BranchRepository) {}

  /**
   * Every branch of the caller's organization, archived ones included.
   *
   * Archived branches are hidden from pickers, not from this listing: a
   * membership can still cover one (archival never drops the edge — a
   * manager keeps the history of a store that closed), and a branch editor
   * that could not name it would silently drop it on the next save.
   * Filtering is the caller's, because only the caller knows whether it is
   * drawing a picker or an editor.
   */
  async execute(actor: Actor): Promise<Branch[]> {
    if (!hasPermission(actor, PERMISSIONS.BRANCHES_READ)) {
      throw new ForbiddenMembershipActionError();
    }
    return this.branches.list(requireOrganization(actor));
  }
}

export class GetMembershipBranchesUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly branchMemberships: BranchMembershipRepository,
  ) {}

  /**
   * A read, so it stops at `branches.read` and the tenant scope rather than
   * running the administration ceiling: the ceiling exists to bound who may
   * CHANGE a membership, and applying it here would hide from an admin the
   * very fact they need to decide whether they may act.
   */
  async execute(actor: Actor, userId: string): Promise<string[]> {
    if (!hasPermission(actor, PERMISSIONS.BRANCHES_READ)) {
      throw new ForbiddenMembershipActionError();
    }
    const organizationId = requireOrganization(actor);
    const membership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      userId,
    );
    if (!membership) {
      throw new MembershipNotFoundError(organizationId, userId);
    }
    return this.branchMemberships.listBranchIds(membership.id);
  }
}

export interface SetMembershipBranchesInput {
  userId: string;
  /** The full desired set. Anything absent from it is removed. */
  branchIds: string[];
}

/**
 * Replaces the set of branches a membership covers.
 *
 * A replace rather than an assign/remove pair: the editor's intent is a set,
 * one request expresses it, repeating it converges, and web-bff's
 * GatewayClient speaks GET/POST/PATCH only — a PUT-per-branch surface would
 * have needed a new verb and N requests to say one thing.
 *
 * Every id is validated against the ACTOR'S organization before anything is
 * written. A membership of org A covering a branch of org B would widen
 * someone's visibility across the tenant boundary, which is exactly what this
 * table exists to scope.
 *
 * No event, deliberately, and for the reason the assign use case gave before
 * it: resolution reads this table at mint time and nothing else consumes
 * branch membership, so a contract nobody reads would be a promise nobody
 * keeps. The person's next token carries the new `br` claim.
 */
export class SetMembershipBranchesUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly branches: BranchRepository,
    private readonly branchMemberships: BranchMembershipRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    input: SetMembershipBranchesInput,
  ): Promise<string[]> {
    const { organizationId, target } = await requireAdministrableTarget(
      actor,
      PERMISSIONS.BRANCHES_MANAGE_MEMBERS,
      this.memberships,
      input.userId,
    );

    const desired = [...new Set(input.branchIds)];
    for (const branchId of desired) {
      const branch = await this.branches.findByOrganizationAndId(
        organizationId,
        branchId,
      );
      if (!branch) {
        throw new BranchNotFoundError(organizationId, branchId);
      }
    }

    const current = await this.branchMemberships.listBranchIds(target.id);
    const now = this.clock.now();

    for (const branchId of desired) {
      if (!current.includes(branchId)) {
        await this.branchMemberships.assign({
          membershipId: target.id,
          branchId,
          createdAt: now,
        });
      }
    }
    for (const branchId of current) {
      if (!desired.includes(branchId)) {
        await this.branchMemberships.remove(target.id, branchId);
      }
    }

    return desired;
  }
}
