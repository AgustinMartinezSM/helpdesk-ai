import type { Actor } from '@helpdesk-ai/security';
import {
  InvitationAddresseeMismatchError,
  InvitationNotFoundError,
  InvitationNotRedeemableError,
} from '../../domain/errors';
import {
  isExpired,
  normalizeInviteeEmail,
  canGrantRoleTemplate,
  type Invitation,
} from '../../domain/invitation';
import { grantsAccess, type Membership } from '../../domain/membership';
import { isActive } from '../../domain/organization';
import {
  hashInvitationSecret,
  invitationHashesMatch,
  parseInvitationCode,
} from '../invitation-code.codec';
import type {
  InvitationEventPublisher,
  MembershipEventPublisher,
} from '../ports/event-publisher';
import type { InvitationRepository } from '../ports/invitation.repository';
import type { MembershipRepository } from '../ports/membership.repository';
import type {
  Clock,
  IdGenerator,
  OrganizationRepository,
} from '../ports/organization.repository';

export interface AcceptInvitationInput {
  code: string;
  /**
   * The redeemer's address, read from the VERIFIED token claim by the
   * controller. Never from the request body: a body field would let whoever
   * holds a leaked code choose who they are.
   */
  actorEmail: string;
  correlationId?: string;
}

export interface AcceptedInvitation {
  invitation: Invitation;
  membership: Membership;
  /** False when the person already belonged; their existing row is untouched. */
  membershipCreated: boolean;
}

/**
 * Redeems an invitation: consumes the code and creates the membership, in one
 * transaction (ADR 0019).
 *
 * Tenantless on purpose — this is the one route on this service that does NOT
 * call requireOrganization, because the whole point is that the caller does
 * not belong yet. There is no permission key either: holding the code while
 * being the addressed person IS the authorization, the shape PATCH /users/me
 * already uses for "being yourself is enough".
 *
 * Every refusal below except the addressee one collapses into a single
 * message that does not say which applied. That is deliberate: the caller is
 * not a member, and telling them the difference between "revoked", "the admin
 * who invited you was deactivated" and "the organization is suspended" would
 * report an organization's internal state to an outsider holding a code.
 */
export class AcceptInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly memberships: MembershipRepository,
    private readonly organizations: OrganizationRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: InvitationEventPublisher &
      MembershipEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    input: AcceptInvitationInput,
  ): Promise<AcceptedInvitation> {
    const parsed = parseInvitationCode(input.code);
    if (!parsed) {
      throw new InvitationNotFoundError();
    }

    const invitation = await this.invitations.findById(parsed.id);
    // A malformed code, an unknown id and a wrong secret all land here, so
    // the endpoint cannot be used to confirm that an invitation id is real.
    if (
      !invitation ||
      !invitationHashesMatch(
        hashInvitationSecret(parsed.secret),
        invitation.codeHash,
      )
    ) {
      throw new InvitationNotFoundError();
    }

    if (normalizeInviteeEmail(input.actorEmail) !== invitation.inviteeEmail) {
      // Named rather than folded into the generic refusal: someone signed in
      // with the wrong one of their accounts is the common case, and the
      // holder of the code already knows the code is real, so this tells them
      // nothing they could not deduce. It still never says WHICH address.
      throw new InvitationAddresseeMismatchError();
    }

    const now = this.clock.now();
    if (invitation.status !== 'pending' || isExpired(invitation, now)) {
      throw new InvitationNotRedeemableError();
    }

    await this.assertStillHonourable(invitation);

    const membership: Membership = {
      id: this.ids.next(),
      organizationId: invitation.organizationId,
      userId: actor.id,
      roleTemplate: invitation.roleTemplate,
      status: 'active',
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    const redeemed = await this.invitations.redeem({
      invitationId: invitation.id,
      acceptedByUserId: actor.id,
      at: now,
      membership,
    });
    if (!redeemed) {
      // Another request consumed it between the checks above and the
      // conditional UPDATE. Same generic refusal: exactly one redemption wins.
      throw new InvitationNotRedeemableError();
    }

    if (redeemed.membershipCreated) {
      await this.events.membershipCreated(
        redeemed.membership,
        input.correlationId,
      );
    }
    await this.events.invitationAccepted(
      redeemed.invitation,
      actor.id,
      redeemed.membershipCreated ? redeemed.membership.id : undefined,
      input.correlationId,
    );

    return redeemed;
  }

  /**
   * Re-validates, at redemption time, what was true when the invitation was
   * issued. An invitation lives seven days and neither of these is frozen
   * into the row:
   *
   * - The issuer may have been suspended, deactivated or demoted since. An
   *   invitation must not outlive the authority that created it, or removing
   *   a compromised admin would leave their outstanding offers live for a
   *   week. organizations-service consumes no membership events, so nothing
   *   sweeps them — checking here is what closes it.
   * - The organization may have been suspended. Accepting into one would
   *   write an active membership that ResolveActiveMembershipUseCase then
   *   skips, handing the person a tenantless token indistinguishable from
   *   belonging nowhere — collapsing exactly the distinction ADR 0014's
   *   failure taxonomy exists to preserve.
   */
  private async assertStillHonourable(invitation: Invitation): Promise<void> {
    const organization = await this.organizations.findById(
      invitation.organizationId,
    );
    if (!organization || !isActive(organization)) {
      throw new InvitationNotRedeemableError();
    }

    const issuer = await this.memberships.findByOrganizationAndUser(
      invitation.organizationId,
      invitation.invitedByUserId,
    );
    if (
      !issuer ||
      !grantsAccess(issuer) ||
      !canGrantRoleTemplate(issuer.roleTemplate, invitation.roleTemplate)
    ) {
      throw new InvitationNotRedeemableError();
    }
  }
}
