import type { Actor } from '@helpdesk-ai/security';
import { isExpired, type Invitation } from '../../domain/invitation';
import type { InvitationRepository } from '../ports/invitation.repository';
import type { Clock } from '../ports/organization.repository';
import { requireInviter } from './issue-invitation';

export interface ListInvitationsInput {
  status?: Invitation['status'];
  limit: number;
  offset: number;
}

/**
 * One row of the issuing side's view. `expired` is DERIVED, never stored:
 * nothing sweeps invitations because the repository has no scheduler, so a
 * stored flag would be wrong between the moment it came due and the moment
 * something nobody built got around to writing it.
 *
 * There is no code and no code hash here, and there never can be — the code
 * exists in exactly one response, at issue time.
 */
export interface InvitationView {
  id: string;
  inviteeEmail: string;
  roleTemplate: string;
  status: string;
  expired: boolean;
  invitedByUserId: string;
  expiresAt: string;
  acceptedByUserId: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

export class ListInvitationsUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    input: ListInvitationsInput,
  ): Promise<InvitationView[]> {
    const organizationId = requireInviter(actor);
    const rows = await this.invitations.list({
      organizationId,
      status: input.status,
      limit: input.limit,
      offset: input.offset,
    });
    const now = this.clock.now();
    return rows.map((invitation) => toView(invitation, now));
  }
}

export function toView(invitation: Invitation, now: Date): InvitationView {
  return {
    id: invitation.id,
    inviteeEmail: invitation.inviteeEmail,
    roleTemplate: invitation.roleTemplate,
    status: invitation.status,
    expired: invitation.status === 'pending' && isExpired(invitation, now),
    invitedByUserId: invitation.invitedByUserId,
    expiresAt: invitation.expiresAt.toISOString(),
    acceptedByUserId: invitation.acceptedByUserId,
    acceptedAt: invitation.acceptedAt?.toISOString() ?? null,
    createdAt: invitation.createdAt.toISOString(),
  };
}
