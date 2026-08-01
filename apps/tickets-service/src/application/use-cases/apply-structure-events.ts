import type {
  ApplyBranchRef,
  ApplyStationRef,
  BranchRefRepository,
  StationRefRepository,
} from '../ports/structure-refs.repository';

/**
 * Thin orchestration on purpose, like users-service's membership applies:
 * idempotency and ordering guarantees live in the repository's atomic LWW
 * upsert (see the port contract), so these use cases only translate event
 * payloads into apply calls. created and updated share one apply per
 * subject because the projection stores last-write state — an archive IS an
 * update to status (see the contract's comment).
 */

export class ApplyBranchEventUseCase {
  constructor(private readonly branches: BranchRefRepository) {}

  async execute(input: ApplyBranchRef): Promise<void> {
    await this.branches.apply(input);
  }
}

export class ApplyStationEventUseCase {
  constructor(private readonly stations: StationRefRepository) {}

  async execute(input: ApplyStationRef): Promise<void> {
    await this.stations.apply(input);
  }
}
