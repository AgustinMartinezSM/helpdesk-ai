import type { PermissionKey } from './permissions.js';

/**
 * Platform-wide authorization vocabulary, derived from the verified access
 * token claims. As of the permission migration this is the only Actor: the
 * domain-local copies tickets-service and users-service carried are deleted,
 * so every authorization call site goes through this one shape.
 *
 * This is the final shape of the tenancy migration. `roles` is gone with the
 * token's compatibility claim (phase 8): authorization reads permissions, and
 * the product's role names live in auth-service's user model, not here.
 */
export interface Actor {
  readonly id: string;
  /**
   * Tenant context (ADR 0014). Deliberately still optional at the end of the
   * migration: a token for an account that belongs to no organization yet is
   * a real minted state — registration and membership creation race, and the
   * product preserves that window rather than pretending it away. The refusal
   * lives in requireOrganization at the domain boundary, not in the type.
   */
  readonly organizationId?: string;
  /**
   * Required on purpose — the enforcement payoff of phase 8: an Actor cannot
   * be built without deciding its permissions. An empty set is a decision
   * (an unprivileged caller), not a forgotten field.
   */
  readonly permissions: ReadonlySet<string>;
}

/**
 * Whether the token granted this permission. An empty set denies everything,
 * which is what an absent `perms` claim becomes at the controller boundary —
 * a token loses capabilities rather than gaining them.
 */
export function hasPermission(
  actor: Actor,
  permission: PermissionKey,
): boolean {
  return actor.permissions.has(permission);
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
