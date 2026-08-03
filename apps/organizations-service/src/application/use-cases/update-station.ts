import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import type { OperationalStation, StationStatus } from '../../domain/branch';
import { StationNotFoundError } from '../../domain/errors';
import {
  requireStructureAdministrator,
  resolveResponsibleMembershipId,
} from '../structure-administration';
import type { StructureEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type { OperationalStationRepository } from '../ports/structure.repository';
import type { Clock } from '../ports/organization.repository';

export interface UpdateStationInput {
  stationId: string;
  name?: string;
  status?: StationStatus;
  /** null clears the column; undefined leaves it alone. */
  area?: string | null;
  /** By userId, like creation; null means the place answers to nobody. */
  responsibleUserId?: string | null;
  correlationId?: string;
}

/**
 * Renames, re-areas, archives or re-assigns responsibility for a station,
 * gated on `branches.update`. Same lifecycle stance as branches: archived is
 * reversible, no transition table, no version to protect from a redundant
 * write.
 *
 * A newly named responsible person gets the same same-organization check as
 * at creation; null clears the column — a station may answer to nobody, and
 * that is what keeps removing a manager from the organization from taking
 * the place down with them (the SET NULL the schema already relies on).
 */
export class UpdateStationUseCase {
  constructor(
    private readonly stations: OperationalStationRepository,
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
    private readonly events: StructureEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    input: UpdateStationInput,
  ): Promise<OperationalStation> {
    const organizationId = requireStructureAdministrator(
      actor,
      PERMISSIONS.BRANCHES_UPDATE,
    );

    const station = await this.stations.findByOrganizationAndId(
      organizationId,
      input.stationId,
    );
    if (!station) {
      throw new StationNotFoundError(organizationId, input.stationId);
    }

    const responsibleMembershipId =
      input.responsibleUserId === undefined || input.responsibleUserId === null
        ? input.responsibleUserId
        : await resolveResponsibleMembershipId(
            this.memberships,
            station.organizationId,
            input.responsibleUserId,
          );

    const updated = await this.stations.update(
      station.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(responsibleMembershipId !== undefined
          ? { responsibleMembershipId }
          : {}),
      },
      this.clock.now(),
    );

    await this.events.stationUpdated(updated, input.correlationId);
    return updated;
  }
}
