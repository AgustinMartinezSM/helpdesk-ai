import {
  BranchNotFoundError,
  MembershipNotFoundError,
} from '../../domain/errors';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  BranchMembershipRepository,
  BranchRepository,
} from '../ports/structure.repository';
import type { Clock } from '../ports/organization.repository';

export interface AssignBranchMembershipInput {
  organizationId: string;
  userId: string;
  branchId: string;
}

/**
 * Covers a membership with a branch — the edge `tickets.read_branch` reads
 * through the `br` claim (Sprint 9.5, D2).
 *
 * Both ends are validated against the SAME organization before the edge is
 * written: a membership of org A covering a branch of org B would widen
 * someone's visibility across the tenant boundary, which is exactly what
 * this table exists to scope.
 *
 * Idempotent (ON CONFLICT DO NOTHING): assigning twice is one edge, and the
 * PUT verb promises exactly that. NO event, deliberately — resolution reads
 * this table at mint time, and nothing else consumes branch membership yet;
 * a contract nobody reads is a promise nobody keeps.
 */
export class AssignBranchMembershipUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly branches: BranchRepository,
    private readonly branchMemberships: BranchMembershipRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: AssignBranchMembershipInput): Promise<void> {
    const membership = await this.memberships.findByOrganizationAndUser(
      input.organizationId,
      input.userId,
    );
    if (!membership) {
      throw new MembershipNotFoundError(input.organizationId, input.userId);
    }

    const branch = await this.branches.findByOrganizationAndId(
      input.organizationId,
      input.branchId,
    );
    if (!branch) {
      throw new BranchNotFoundError(input.organizationId, input.branchId);
    }

    await this.branchMemberships.assign({
      membershipId: membership.id,
      branchId: branch.id,
      createdAt: this.clock.now(),
    });
  }
}
