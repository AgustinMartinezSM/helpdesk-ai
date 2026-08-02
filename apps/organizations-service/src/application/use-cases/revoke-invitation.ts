import type { Actor } from '@helpdesk-ai/security';
import {
  InvitationNotFoundError,
  InvitationNotRedeemableError,
} from '../../domain/errors';
import type { Invitation } from '../../domain/invitation';
import type { InvitationEventPublisher } from '../ports/event-publisher';
import type { InvitationRepository } from '../ports/invitation.repository';
import type { Clock } from '../ports/organization.repository';
import { requireInviter } from './issue-invitation';

/**
 * Withdraws a pending invitation. The row is kept — never deleted — because
 * it is the record that someone was invited and that the offer was pulled.
 *
 * Two refusals, and the split matters: an invitation this organization does
 * not own is NOT FOUND (a foreign id and a nonexistent one must answer
 * alike), while one that exists here but is no longer pending is a CONFLICT
 * telling the admin to re-read. The second is safe to be specific about —
 * they are a member of the organization that owns the row.
 *
 * Revoking does not reach anyone who already redeemed: the person is a member
 * by then, and removing them is the membership lifecycle's job, not this
 * one's. A revoke that loses the race to a redemption says so rather than
 * pretending it undid it.
 */
export class RevokeInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly clock: Clock,
    private readonly events: InvitationEventPublisher,
  ) {}

  async execute(actor: Actor, invitationId: string): Promise<Invitation> {
    const organizationId = requireInviter(actor);

    const revoked = await this.invitations.revoke(
      organizationId,
      invitationId,
      this.clock.now(),
    );
    if (revoked) {
      await this.events.invitationRevoked(revoked, actor.id);
      return revoked;
    }

    // Nothing was updated. Distinguish "not ours / not there" from "ours but
    // already settled" with one extra scoped read, so the admin gets the
    // answer that helps without the endpoint confirming foreign ids.
    const existing = await this.invitations.findByOrganizationAndId(
      organizationId,
      invitationId,
    );
    if (!existing) {
      throw new InvitationNotFoundError();
    }
    throw new InvitationNotRedeemableError();
  }
}
