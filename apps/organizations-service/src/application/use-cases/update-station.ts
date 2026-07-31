import type { OperationalStation, StationStatus } from '../../domain/branch';
import {
  MembershipNotFoundError,
  StationNotFoundError,
} from '../../domain/errors';
import type { StructureEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type { OperationalStationRepository } from '../ports/structure.repository';
import type { Clock } from '../ports/organization.repository';

export interface UpdateStationInput {
  organizationId: string;
  stationId: string;
  name?: string;
  status?: StationStatus;
  /** null clears the column; undefined leaves it alone. */
  area?: string | null;
  responsibleMembershipId?: string | null;
  correlationId?: string;
}

/**
 * Renames, re-areas, archives or re-assigns responsibility for a station.
 * Same lifecycle stance as branches: archived is reversible, no transition
 * table, no version to protect from a redundant write.
 *
 * A newly named responsible manager gets the same same-organization check
 * as at creation; null clears the column — a station may answer to nobody.
 */
export class UpdateStationUseCase {
  constructor(
    private readonly stations: OperationalStationRepository,
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
    private readonly events: StructureEventPublisher,
  ) {}

  async execute(input: UpdateStationInput): Promise<OperationalStation> {
    const station = await this.stations.findByOrganizationAndId(
      input.organizationId,
      input.stationId,
    );
    if (!station) {
      throw new StationNotFoundError(input.organizationId, input.stationId);
    }

    if (
      input.responsibleMembershipId !== undefined &&
      input.responsibleMembershipId !== null
    ) {
      const responsible = await this.memberships.findByOrganizationAndId(
        station.organizationId,
        input.responsibleMembershipId,
      );
      if (!responsible) {
        throw MembershipNotFoundError.byId(
          station.organizationId,
          input.responsibleMembershipId,
        );
      }
    }

    const updated = await this.stations.update(
      station.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.area !== undefined ? { area: input.area } : {}),
        ...(input.responsibleMembershipId !== undefined
          ? { responsibleMembershipId: input.responsibleMembershipId }
          : {}),
      },
      this.clock.now(),
    );

    await this.events.stationUpdated(updated, input.correlationId);
    return updated;
  }
}
