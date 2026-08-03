import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import { MembershipNotFoundError } from '../../domain/errors';
import {
  canGrantRoleTemplate,
  GRANTABLE_ROLE_TEMPLATES,
} from '../../domain/role-grants';
import { grantsAccess, type RoleTemplate } from '../../domain/membership';
import type { MembershipRepository } from '../ports/membership.repository';

/**
 * Which role templates THIS caller may hand out (Sprint 9.14).
 *
 * The list existed in three places before this: the two ceilings in the
 * domain, and a hardcoded array in the browser that offered seven choices to
 * everybody. The browser's copy matched the server by coincidence — both were
 * "everything except owner" — and it was wrong per actor anyway, since the
 * real answer depends on what the caller's own template holds. An agent was
 * offered seven roles and would have been refused all seven, on submit,
 * after typing an email address.
 *
 * So the answer comes from the same functions the write paths check, applied
 * to the same stored membership. A control rendered from this cannot offer
 * something the server will then refuse.
 *
 * Read from the STORED template, never the token: an access token outlives a
 * demotion by JWT_ACCESS_TTL_SECONDS, and this decides what a screen will
 * offer to do next.
 */
export class ListGrantableRoleTemplatesUseCase {
  constructor(private readonly memberships: MembershipRepository) {}

  async execute(actor: Actor): Promise<RoleTemplate[]> {
    // Either key, because either one leads to a screen that has to choose a
    // template: inviting somebody new, or re-roling somebody who is already
    // here. Holding neither means there is nothing to answer.
    if (
      !hasPermission(actor, PERMISSIONS.PEOPLE_INVITE) &&
      !hasPermission(actor, PERMISSIONS.PEOPLE_ASSIGN_ROLES)
    ) {
      return [];
    }
    const organizationId = requireOrganization(actor);

    const membership = await this.memberships.findByOrganizationAndUser(
      organizationId,
      actor.id,
    );
    if (!membership || !grantsAccess(membership)) {
      // The token says they belong and the row disagrees — the same refusal
      // issuing an invitation gives, for the same reason.
      throw new MembershipNotFoundError(organizationId, actor.id);
    }

    return GRANTABLE_ROLE_TEMPLATES.filter((template) =>
      canGrantRoleTemplate(membership.roleTemplate, template),
    );
  }
}
