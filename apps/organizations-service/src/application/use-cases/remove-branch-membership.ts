import {
  BranchNotFoundError,
  MembershipNotFoundError,
} from '../../domain/errors';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  BranchMembershipRepository,
  BranchRepository,
} from '../ports/structure.repository';

export interface RemoveBranchMembershipInput {
  organizationId: string;
  userId: string;
  branchId: string;
}

/**
 * Uncovers a branch from a membership. Idempotent like the assignment:
 * removing an absent edge succeeds, because DELETE promises a state, not a
 * mutation. Both ends are still validated first — "that branch is not
 * yours to touch" must stay a 404 even when the edge would not have
 * existed, or the response would leak which foreign ids are real.
 *
 * No event, for the assignment's reason: resolution reads the database at
 * mint time, and nothing else consumes branch membership yet.
 */
export class RemoveBranchMembershipUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly branches: BranchRepository,
    private readonly branchMemberships: BranchMembershipRepository,
  ) {}

  async execute(input: RemoveBranchMembershipInput): Promise<void> {
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

    await this.branchMemberships.remove(membership.id, branch.id);
  }
}
