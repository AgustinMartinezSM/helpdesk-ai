import {
  hasPermission,
  requireOrganization,
  type Actor,
  type PermissionKey,
} from '@helpdesk-ai/security';
import {
  ForbiddenStructureActionError,
  MembershipNotFoundError,
} from '../domain/errors';
import type { MembershipRepository } from './ports/membership.repository';

/**
 * The two checks every structure write shares (Sprint 9.11).
 *
 * The organization comes from the token and never from the request. Until
 * this sprint it was a path parameter, which an operator holding the database
 * could be trusted with and a browser cannot: it made "which tenant" a thing
 * the caller said rather than a thing the platform knew.
 *
 * There is no ceiling here and no target rule, unlike membership
 * administration (ADR 0021). A branch is not a principal — editing one cannot
 * grant anybody anything they did not already have, so the only questions are
 * whether the caller holds the key and which organization they are in.
 */
export function requireStructureAdministrator(
  actor: Actor,
  permission: PermissionKey,
): string {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenStructureActionError();
  }
  return requireOrganization(actor);
}

/**
 * Resolves the person who answers for a station into the membership row the
 * column points at.
 *
 * The public surface names them by `userId` — the identifier the People
 * screen shows and every membership route already speaks. The membership id
 * is this service's internal key; nothing a browser can reach ever returns
 * one, so asking for it was an operator-shaped interface, not a product one.
 *
 * Scoped to the caller's organization, so a person from another tenant and a
 * user id that never existed answer the same not-found. That check is what
 * stops one organization from pointing a station at another's people.
 */
export async function resolveResponsibleMembershipId(
  memberships: MembershipRepository,
  organizationId: string,
  responsibleUserId: string,
): Promise<string> {
  const membership = await memberships.findByOrganizationAndUser(
    organizationId,
    responsibleUserId,
  );
  if (!membership) {
    throw new MembershipNotFoundError(organizationId, responsibleUserId);
  }
  return membership.id;
}
