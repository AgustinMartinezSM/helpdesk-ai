import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { OperationalStation } from '../../domain/branch';
import {
  BranchNotFoundError,
  DuplicateStationCodeError,
} from '../../domain/errors';
import {
  requireStructureAdministrator,
  resolveResponsibleMembershipId,
} from '../structure-administration';
import type { StructureEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  BranchRepository,
  OperationalStationRepository,
} from '../ports/structure.repository';
import type { Clock, IdGenerator } from '../ports/organization.repository';

export interface CreateStationInput {
  branchId: string;
  code: string;
  name: string;
  area?: string;
  /** WHO answers for the place, by the id the People screen shows. */
  responsibleUserId?: string;
  correlationId?: string;
}

/**
 * Registers an operational station under a branch — a place, never a
 * principal (ADR 0016/0017): it gets no credential and never acts.
 *
 * Gated on `branches.update`: a station is contents of a branch, not a scope
 * of its own (Sprint 9.11, D1).
 *
 * The responsible person is named by `userId` and resolved to a membership of
 * the caller's organization. Sprint 9.11 changed that identifier: the column
 * holds a membership id, but nothing a browser can reach ever returns one, so
 * asking for it was an operator-shaped interface. The same-organization check
 * survives the change and is what stops one tenant pointing a station at
 * another's people; foreign and nonexistent answer the same not-found.
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

  async execute(
    actor: Actor,
    input: CreateStationInput,
  ): Promise<OperationalStation> {
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

    const responsibleMembershipId =
      input.responsibleUserId === undefined
        ? null
        : await resolveResponsibleMembershipId(
            this.memberships,
            branch.organizationId,
            input.responsibleUserId,
          );

    const now = this.clock.now();
    const created = await this.stations.create({
      id: this.ids.next(),
      organizationId: branch.organizationId,
      branchId: branch.id,
      code: input.code,
      name: input.name,
      area: input.area ?? null,
      responsibleMembershipId,
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
