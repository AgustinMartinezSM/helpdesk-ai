import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenInvitationActionError,
  InvalidRoleTemplateError,
  MembershipNotFoundError,
  RoleTemplateNotGrantableError,
} from '../../domain/errors';
import {
  expiresAtFrom,
  normalizeInviteeEmail,
  type Invitation,
} from '../../domain/invitation';
import { grantsAccess } from '../../domain/membership';
import {
  canGrantRoleTemplate,
  isGrantableRoleTemplate,
} from '../../domain/role-grants';
import {
  composeInvitationCode,
  generateInvitationSecret,
  hashInvitationSecret,
} from '../invitation-code.codec';
import type { InvitationEventPublisher } from '../ports/event-publisher';
import type { InvitationRepository } from '../ports/invitation.repository';
import type { MembershipRepository } from '../ports/membership.repository';
import type { Clock, IdGenerator } from '../ports/organization.repository';

export interface IssueInvitationInput {
  inviteeEmail: string;
  roleTemplate: string;
  correlationId?: string;
}

export interface IssuedInvitation {
  invitation: Invitation;
  /**
   * The only time this value exists outside the issuer's hands. It is not
   * stored, not logged and not published — the caller returns it once and
   * forgets it.
   */
  code: string;
}

/**
 * people.invite gates issuing, listing and revoking. Redeeming needs no key:
 * the invitee is by definition not a member yet, so there is no template to
 * carry one.
 */
export function requireInviter(actor: Actor): string {
  if (!hasPermission(actor, PERMISSIONS.PEOPLE_INVITE)) {
    throw new ForbiddenInvitationActionError();
  }
  return requireOrganization(actor);
}

/**
 * Issues a redeemable offer of membership.
 *
 * The security work here is the grant ceiling, and it reads the ISSUER'S
 * STORED MEMBERSHIP rather than their token. Access tokens live
 * JWT_ACCESS_TTL_SECONDS (900 by default) and nothing compares the `mv`
 * claim, so an admin demoted a minute ago still carries admin permissions in
 * a valid token — issuing from those claims would let them hand out what they
 * no longer have, for a quarter of an hour, in a row that outlives the
 * mistake by a week.
 */
export class IssueInvitationUseCase {
  constructor(
    private readonly invitations: InvitationRepository,
    private readonly memberships: MembershipRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
    private readonly events: InvitationEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    input: IssueInvitationInput,
  ): Promise<IssuedInvitation> {
    const organizationId = requireInviter(actor);

    // `owner` is refused here and not by the subset check below, because
    // TEMPLATE_PERMISSIONS resolves owner and organization_admin to the same
    // set — a subset test alone would let an admin mint a peer at the top.
    if (!isGrantableRoleTemplate(input.roleTemplate)) {
      throw new InvalidRoleTemplateError(input.roleTemplate);
    }

    const issuer = await this.memberships.findByOrganizationAndUser(
      organizationId,
      actor.id,
    );
    if (!issuer || !grantsAccess(issuer)) {
      // The token says they belong; the row says otherwise, or says they are
      // suspended. The row wins.
      throw new MembershipNotFoundError(organizationId, actor.id);
    }
    if (!canGrantRoleTemplate(issuer.roleTemplate, input.roleTemplate)) {
      throw new RoleTemplateNotGrantableError(input.roleTemplate);
    }

    const now = this.clock.now();
    const id = this.ids.next();
    const secret = generateInvitationSecret();

    const invitation = await this.invitations.create({
      id,
      organizationId,
      inviteeEmail: normalizeInviteeEmail(input.inviteeEmail),
      roleTemplate: input.roleTemplate,
      status: 'pending',
      codeHash: hashInvitationSecret(secret),
      invitedByUserId: actor.id,
      // Null from this path, always. A placement arrives on an invitation only
      // through a CSV import (Sprint 9.15), which knows a branch and a
      // department to put there; this form asks for neither, and inventing a
      // default would place people somewhere nobody chose.
      branchId: null,
      departmentId: null,
      expiresAt: expiresAtFrom(now),
      acceptedByUserId: null,
      acceptedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await this.events.invitationIssued(invitation, input.correlationId);

    return { invitation, code: composeInvitationCode(id, secret) };
  }
}
