import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { Branch, BranchStatus } from '../../domain/branch';
import { BranchNotFoundError } from '../../domain/errors';
import { requireStructureAdministrator } from '../structure-administration';
import type { StructureEventPublisher } from '../ports/event-publisher';
import type { BranchRepository } from '../ports/structure.repository';
import type { Clock } from '../ports/organization.repository';

export interface UpdateBranchInput {
  branchId: string;
  name?: string;
  status?: BranchStatus;
  /** null clears the column; undefined leaves it alone. */
  timezone?: string | null;
  address?: string | null;
  correlationId?: string;
}

/**
 * Renames, re-zones or archives a branch — one operation, one event, gated
 * on `branches.update`.
 *
 * The CODE is absent from the input on purpose and always was: it is the
 * stable operator-facing key other systems and people refer to, and renaming
 * it would silently orphan every reference outside this database.
 *
 * There is no transition table here, unlike membership status: `archived`
 * is reversible via this same endpoint because a place is not an access
 * grant — un-archiving a store restores a name, while reactivating a member
 * restores access. No self-loop refusal either, for the same reason: no
 * version rides on a branch, so a redundant write invalidates nothing.
 *
 * Archiving does NOT cascade to the branch's departments and stations
 * (Sprint 9.11, D4). A cascade could not be undone — un-archiving would have
 * to guess which children were already archived beforehand — and it is not
 * needed: tickets-service refuses an archived branch at the branch lookup, so
 * nothing under it is reachable through it.
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

  async execute(actor: Actor, input: UpdateBranchInput): Promise<Branch> {
    const organizationId = requireStructureAdministrator(
      actor,
      PERMISSIONS.BRANCHES_UPDATE,
    );

    const branch = await this.branches.findByOrganizationAndId(
      organizationId,
      input.branchId,
    );
    if (!branch) {
      throw new BranchNotFoundError(organizationId, input.branchId);
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
