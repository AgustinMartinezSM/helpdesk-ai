import {
  hasPermission,
  requireOrganization,
  type Actor,
  type PermissionKey,
} from '@helpdesk-ai/security';
import {
  ForbiddenMembershipActionError,
  MembershipNotAdministrableError,
  MembershipNotFoundError,
  SelfMembershipAdministrationError,
} from '../domain/errors';
import { grantsAccess, type Membership } from '../domain/membership';
import {
  canGrantRoleTemplate,
  isGrantableRoleTemplate,
} from '../domain/role-grants';
import type { MembershipRepository } from './ports/membership.repository';

export interface AdministrationContext {
  organizationId: string;
  /** The actor's STORED membership — never their token's picture of it. */
  actorMembership: Membership;
  target: Membership;
}

/**
 * The checks every membership administration shares, in the order they have
 * to run (ADR 0021).
 *
 * All of it reads rows. An access token lives JWT_ACCESS_TTL_SECONDS (900 by
 * default) and nothing compares `mv`, so a demoted admin still carries admin
 * permissions in a valid token — deciding from those claims would let them
 * spend authority they no longer have for a quarter of an hour, on somebody
 * else's membership.
 *
 * The self-check is what closes the last-administrator problem: the actor
 * must hold the key and be an active member to act at all, and can never be
 * the target, so at least one privileged member survives any sequence of
 * these calls. Counting the survivors instead would race concurrent requests.
 */
export async function requireAdministrableTarget(
  actor: Actor,
  permission: PermissionKey,
  memberships: MembershipRepository,
  targetUserId: string,
): Promise<AdministrationContext> {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenMembershipActionError();
  }
  const organizationId = requireOrganization(actor);

  if (targetUserId === actor.id) {
    throw new SelfMembershipAdministrationError();
  }

  const actorMembership = await memberships.findByOrganizationAndUser(
    organizationId,
    actor.id,
  );
  if (!actorMembership || !grantsAccess(actorMembership)) {
    // The token says they belong; the row says otherwise, or says they are
    // suspended. The row wins — the same refusal issuing an invitation gives.
    throw new MembershipNotFoundError(organizationId, actor.id);
  }

  const target = await memberships.findByOrganizationAndUser(
    organizationId,
    targetUserId,
  );
  if (!target) {
    // Scoped by construction, so a member of another organization and a user
    // id that never existed answer alike: this surface cannot be used to
    // discover which people belong where.
    throw new MembershipNotFoundError(organizationId, targetUserId);
  }

  // The target ceiling. Without it the grant ceiling alone would let an
  // administrator act on anyone at all, because it only looks at where a
  // membership is going and never at what it currently is. `owner` fails the
  // first test rather than the second, because the permission map resolves
  // owner and organization_admin alike and a subset test cannot tell them
  // apart.
  if (
    !isGrantableRoleTemplate(target.roleTemplate) ||
    !canGrantRoleTemplate(actorMembership.roleTemplate, target.roleTemplate)
  ) {
    throw new MembershipNotAdministrableError(target.roleTemplate);
  }

  return { organizationId, actorMembership, target };
}
