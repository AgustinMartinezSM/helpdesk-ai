import type { PermissionKey } from './permissions.js';

/**
 * Platform-wide authorization vocabulary, derived from the verified access
 * token claims. As of the permission migration this is the only Actor: the
 * domain-local copies tickets-service and users-service carried are deleted,
 * so every authorization call site goes through this one shape.
 */
export interface Actor {
  readonly id: string;
  readonly roles: string[];
  /**
   * Tenant context (ADR 0014). Still optional: a token minted before
   * organizations-service existed carries no organization, and neither does
   * one minted for a user who belongs to no organization yet. Making these
   * required is the enforcement phase — the point at which the compiler
   * starts pointing at every call site that has not been updated.
   */
  readonly organizationId?: string;
  readonly permissions?: ReadonlySet<string>;
}

/**
 * Whether the token granted this permission. An absent set denies — the safe
 * direction while tokens minted before the permission claim rolls out are
 * still live.
 */
export function hasPermission(
  actor: Actor,
  permission: PermissionKey,
): boolean {
  return actor.permissions?.has(permission) ?? false;
}

/**
 * The caller's token carries no organization, so there is no tenant to act
 * under.
 *
 * Reachable in ordinary use, not just in a fault: it is the state of every
 * account between registering and organizations-service consuming the
 * registration event, which is normally milliseconds but is not guaranteed.
 * auth-service refuses to mint only when it *cannot determine* membership;
 * "this person belongs nowhere" is a real answer and still produces a token.
 */
export class NoOrganizationContextError extends Error {
  constructor() {
    super('Your account is not part of an organization yet');
    this.name = new.target.name;
  }
}

/**
 * The tenant the actor is acting in, or a refusal.
 *
 * The only bridge from the actor's optional organization to a domain's
 * required one — forgetting it is a type error, not a row belonging to
 * nobody.
 */
export function requireOrganization(actor: Actor): string {
  if (!actor.organizationId) {
    throw new NoOrganizationContextError();
  }
  return actor.organizationId;
}
