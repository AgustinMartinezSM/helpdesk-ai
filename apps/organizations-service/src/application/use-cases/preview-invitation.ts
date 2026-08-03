import type { Actor } from '@helpdesk-ai/security';
import {
  InvitationAddresseeMismatchError,
  InvitationNotFoundError,
  InvitationNotRedeemableError,
} from '../../domain/errors';
import { isExpired, normalizeInviteeEmail } from '../../domain/invitation';
import {
  hashInvitationSecret,
  invitationHashesMatch,
  parseInvitationCode,
} from '../invitation-code.codec';
import type { InvitationRepository } from '../ports/invitation.repository';
import type { OrganizationRepository } from '../ports/organization.repository';
import type { Clock } from '../ports/organization.repository';

export interface PreviewInvitationInput {
  code: string;
  /** From the verified token claim, exactly as accept reads it. */
  actorEmail: string;
}

export interface InvitationPreview {
  organizationId: string;
  /** The one place a person-facing caller learns an organization's name. */
  organizationName: string;
  roleTemplate: string;
  expiresAt: string;
}

/**
 * Answers "what am I about to accept, and from whom" WITHOUT spending the
 * code.
 *
 * It exists because accepting was blind and irreversible: nothing public
 * returns an organization's name, so even the confirmation after redeeming
 * could show only a UUID, and the person had no way to notice they were about
 * to join the wrong company before it happened.
 *
 * It is NOT an oracle. Every path a probe could take is one accept already
 * offers: the caller must present the full code (so they hold the secret),
 * must be authenticated, must be the addressee, and gets the same
 * indistinguishable refusals. What it adds is the organization's NAME — to
 * someone who has already proved they hold an invitation into it.
 *
 * Deliberately NOT re-checked here: the issuer's standing and the
 * organization's status. Those are redemption-time conditions (Sprint 9.8,
 * D7) and re-implementing them would be a second copy of a security rule that
 * must not drift. A preview that succeeds is not a promise that accept will.
 */
export class PreviewInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly organizations: OrganizationRepository,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    input: PreviewInvitationInput,
  ): Promise<InvitationPreview> {
    const parsed = parseInvitationCode(input.code);
    if (!parsed) {
      throw new InvitationNotFoundError();
    }

    const invitation = await this.invitations.findById(parsed.id);
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
      throw new InvitationAddresseeMismatchError();
    }

    if (
      invitation.status !== 'pending' ||
      isExpired(invitation, this.clock.now())
    ) {
      throw new InvitationNotRedeemableError();
    }

    const organization = await this.organizations.findById(
      invitation.organizationId,
    );
    if (!organization) {
      // The FK makes this unreachable while the invitation row exists; a
      // refusal beats previewing a membership into nothing.
      throw new InvitationNotRedeemableError();
    }

    return {
      organizationId: organization.id,
      organizationName: organization.name,
      roleTemplate: invitation.roleTemplate,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }
}
