import type { Branch, BranchStatus } from '../../domain/branch';
import { BranchNotFoundError } from '../../domain/errors';
import type { StructureEventPublisher } from '../ports/event-publisher';
import type { BranchRepository } from '../ports/structure.repository';
import type { Clock } from '../ports/organization.repository';

export interface UpdateBranchInput {
  organizationId: string;
  branchId: string;
  name?: string;
  status?: BranchStatus;
  /** null clears the column; undefined leaves it alone. */
  timezone?: string | null;
  address?: string | null;
  correlationId?: string;
}

/**
 * Renames, re-zones or archives a branch — one operation, one event.
 *
 * There is no transition table here, unlike membership status: `archived`
 * is reversible via this same endpoint because a place is not an access
 * grant — un-archiving a store restores a name, while reactivating a member
 * restores access. No self-loop refusal either, for the same reason: no
 * version rides on a branch, so a redundant write invalidates nothing.
 *
 * The lookup is organization-scoped, so an unknown branch and a foreign one
 * answer the same not-found — confirming existence is the leak.
 */
export class UpdateBranchUseCase {
  constructor(
    private readonly branches: BranchRepository,
    private readonly clock: Clock,
    private readonly events: StructureEventPublisher,
  ) {}

  async execute(input: UpdateBranchInput): Promise<Branch> {
    const branch = await this.branches.findByOrganizationAndId(
      input.organizationId,
      input.branchId,
    );
    if (!branch) {
      throw new BranchNotFoundError(input.organizationId, input.branchId);
    }

    const updated = await this.branches.update(
      branch.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.address !== undefined ? { address: input.address } : {}),
      },
      this.clock.now(),
    );

    // One contract covers rename, status and timezone changes, archive
    // included: an archive IS an update to status, and the consumer projects
    // last-write state, not a lifecycle.
    await this.events.branchUpdated(updated, input.correlationId);
    return updated;
  }
}
