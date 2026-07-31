import type {
  ApplyMembershipCreated,
  ApplyMembershipStatusChanged,
  MembershipProjectionRepository,
} from '../ports/membership-projection.repository';

/**
 * Thin orchestration on purpose: idempotency and ordering guarantees live
 * in the repository's atomic LWW upsert (see the port contract), so these
 * use cases only translate event payloads into apply calls — the same shape
 * analytics-service uses for its snapshots.
 */

export class ApplyMembershipCreatedUseCase {
  constructor(private readonly memberships: MembershipProjectionRepository) {}

  async execute(input: ApplyMembershipCreated): Promise<void> {
    await this.memberships.applyCreated(input);
  }
}

export class ApplyMembershipStatusChangedUseCase {
  constructor(private readonly memberships: MembershipProjectionRepository) {}

  async execute(input: ApplyMembershipStatusChanged): Promise<void> {
    await this.memberships.applyStatusChanged(input);
  }
}
