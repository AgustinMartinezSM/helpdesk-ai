import {
  canTransitionMembershipStatus,
  type Membership,
  type MembershipStatus,
} from '../../domain/membership';
import {
  InvalidMembershipTransitionError,
  MembershipNotFoundError,
} from '../../domain/errors';
import type { MembershipEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type { Clock } from '../ports/organization.repository';

export interface ChangeMembershipStatusInput {
  organizationId: string;
  userId: string;
  to: MembershipStatus;
  correlationId?: string;
}

/**
 * Moves a membership along the transition table and announces the move.
 *
 * A target equal to the current status is refused, not absorbed as a no-op:
 * the table has no self-loops, so an "already there" request means the
 * caller acted on a stale picture of the row, and a success would confirm
 * it. The alternative — writing anyway — would bump the version and
 * invalidate every outstanding token over a non-change.
 *
 * The event carries the PRE-transition status as fromStatus; publishing is
 * best-effort after the commit (ADR 0006), so the status change survives a
 * broker outage even though its announcement may not.
 */
export class ChangeMembershipStatusUseCase {
  constructor(
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
    private readonly events: MembershipEventPublisher,
  ) {}

  async execute(input: ChangeMembershipStatusInput): Promise<Membership> {
    const membership = await this.memberships.findByOrganizationAndUser(
      input.organizationId,
      input.userId,
    );
    if (!membership) {
      throw new MembershipNotFoundError(input.organizationId, input.userId);
    }

    if (!canTransitionMembershipStatus(membership.status, input.to)) {
      throw new InvalidMembershipTransitionError(membership.status, input.to);
    }

    const updated = await this.memberships.changeStatus(
      membership.id,
      input.to,
      this.clock.now(),
    );
    await this.events.membershipStatusChanged(
      updated,
      membership.status,
      input.correlationId,
    );
    return updated;
  }
}
