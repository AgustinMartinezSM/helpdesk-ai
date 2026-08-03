import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  canTransitionMembershipStatus,
  type Membership,
  type MembershipStatus,
} from '../../domain/membership';
import { InvalidMembershipTransitionError } from '../../domain/errors';
import { requireAdministrableTarget } from '../membership-administration';
import type { MembershipEventPublisher } from '../ports/event-publisher';
import type { MembershipRepository } from '../ports/membership.repository';
import type { Clock } from '../ports/organization.repository';

export interface ChangeMembershipStatusInput {
  /** The person being administered. The organization comes from the actor. */
  userId: string;
  to: MembershipStatus;
  correlationId?: string;
}

/**
 * Suspends, reinstates or removes a member, and announces the move.
 *
 * Gated on `people.suspend`, with the shared administration checks in front
 * of it: not yourself, not the owner, and not somebody whose role template
 * outreaches your own (ADR 0021). Until Sprint 9.10 this use case took no
 * actor at all and ran behind a shared process credential — a membership
 * change nobody could be attributed for, which is what ADR 0016 forbids.
 *
 * "Remove" is `deactivated`, never a deleted row: the directory projection
 * and the audit trail are rebuilt from this row and its events. Since 9.10
 * that status is reversible, because the alternative turned out to be a
 * permanent ban nothing said out loud (see MEMBERSHIP_STATUS_TRANSITIONS).
 *
 * A target equal to the current status is refused, not absorbed as a no-op:
 * the table has no self-loops, so an "already there" request means the
 * caller acted on a stale picture of the row, and a success would confirm
 * it. Writing anyway would bump the version and invalidate every outstanding
 * token over a non-change.
 *
 * Suspension is not revocation. The version bump makes outstanding tokens
 * detectably stale, but nothing compares `mv`, so the person keeps their
 * access until the token expires — up to JWT_ACCESS_TTL_SECONDS (ADR 0014).
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

  async execute(
    actor: Actor,
    input: ChangeMembershipStatusInput,
  ): Promise<Membership> {
    const { target } = await requireAdministrableTarget(
      actor,
      PERMISSIONS.PEOPLE_SUSPEND,
      this.memberships,
      input.userId,
    );

    if (!canTransitionMembershipStatus(target.status, input.to)) {
      throw new InvalidMembershipTransitionError(target.status, input.to);
    }

    const updated = await this.memberships.changeStatus(
      target.id,
      input.to,
      this.clock.now(),
    );
    await this.events.membershipStatusChanged(
      updated,
      target.status,
      input.correlationId,
    );
    return updated;
  }
}
