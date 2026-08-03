import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { Branch } from '../../domain/branch';
import {
  DuplicateBranchCodeError,
  OrganizationNotFoundError,
} from '../../domain/errors';
import { requireStructureAdministrator } from '../structure-administration';
import type { StructureEventPublisher } from '../ports/event-publisher';
import type { BranchRepository } from '../ports/structure.repository';
import type {
  Clock,
  IdGenerator,
  OrganizationRepository,
} from '../ports/organization.repository';

export interface CreateBranchInput {
  code: string;
  name: string;
  timezone?: string;
  address?: string;
  correlationId?: string;
}

/**
 * Registers a branch and announces it, so tickets-service can project the
 * `branch_refs` row ticket creation validates against (Sprint 9.5, D4).
 *
 * Gated on `branches.create`, and the organization comes from the actor
 * (Sprint 9.11). Until then this ran behind a shared process credential with
 * the tenant as a path parameter — the last category of write in the product
 * that no person could be attributed for.
 *
 * The organization is still looked up: `requireOrganization` proves the token
 * carries one, not that this database has ever seen it. A branch pointing at
 * an unknown organization would only fail later at the foreign key, and a 500
 * where the caller deserves a 404 is the tickets-service lesson the error
 * filter already records.
 *
 * Publishing is best-effort after the commit (ADR 0006): the branch
 * survives a broker outage even though its announcement may not.
 */
export class CreateBranchUseCase {
  constructor(
    private readonly organizations: OrganizationRepository,
    private readonly branches: BranchRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: StructureEventPublisher,
  ) {}

  async execute(actor: Actor, input: CreateBranchInput): Promise<Branch> {
    const organizationId = requireStructureAdministrator(
      actor,
      PERMISSIONS.BRANCHES_CREATE,
    );

    const organization = await this.organizations.findById(organizationId);
    if (!organization) {
      throw new OrganizationNotFoundError(organizationId);
    }

    const now = this.clock.now();
    const created = await this.branches.create({
      id: this.ids.next(),
      organizationId: organization.id,
      code: input.code,
      name: input.name,
      status: 'active',
      timezone: input.timezone ?? null,
      address: input.address ?? null,
      createdAt: now,
      updatedAt: now,
    });
    if (!created) {
      throw new DuplicateBranchCodeError(organization.id, input.code);
    }

    await this.events.branchCreated(created, input.correlationId);
    return created;
  }
}
