import type { OperationalStation } from '../../domain/branch';
import {
  BranchNotFoundError,
  DuplicateStationCodeError,
  MembershipNotFoundError,
} from '../../domain/errors';
import type { StructureEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  BranchRepository,
  OperationalStationRepository,
} from '../ports/structure.repository';
import type { Clock, IdGenerator } from '../ports/organization.repository';

export interface CreateStationInput {
  organizationId: string;
  branchId: string;
  code: string;
  name: string;
  area?: string;
  responsibleMembershipId?: string;
  correlationId?: string;
}

/**
 * Registers an operational station under a branch — a place, never a
 * principal (ADR 0016/0017): it gets no credential and never acts.
 *
 * The responsible manager, when named, must be a membership of the SAME
 * organization: the id crosses a trust boundary from the operator surface,
 * and a foreign membership on a station would let one tenant point at
 * another's people. Foreign and nonexistent answer the same not-found.
 */
export class CreateStationUseCase {
  constructor(
    private readonly branches: BranchRepository,
    private readonly stations: OperationalStationRepository,
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: StructureEventPublisher,
  ) {}

  async execute(input: CreateStationInput): Promise<OperationalStation> {
    const branch = await this.branches.findByOrganizationAndId(
      input.organizationId,
      input.branchId,
    );
    if (!branch) {
      throw new BranchNotFoundError(input.organizationId, input.branchId);
    }

    if (input.responsibleMembershipId !== undefined) {
      const responsible = await this.memberships.findByOrganizationAndId(
        branch.organizationId,
        input.responsibleMembershipId,
      );
      if (!responsible) {
        throw MembershipNotFoundError.byId(
          branch.organizationId,
          input.responsibleMembershipId,
        );
      }
    }

    const now = this.clock.now();
    const created = await this.stations.create({
      id: this.ids.next(),
      organizationId: branch.organizationId,
      branchId: branch.id,
      code: input.code,
      name: input.name,
      area: input.area ?? null,
      responsibleMembershipId: input.responsibleMembershipId ?? null,
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    if (!created) {
      throw new DuplicateStationCodeError(branch.id, input.code);
    }

    await this.events.stationCreated(created, input.correlationId);
    return created;
  }
}
