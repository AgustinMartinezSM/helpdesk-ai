/**
 * Platform-wide authorization vocabulary, derived from the verified access
 * token claims. Extracted here when the sprint-7 services would have become
 * the third, fourth and fifth copies; tickets-service and users-service
 * still carry their original domain-local copies (migration pending).
 */
export interface Actor {
  readonly id: string;
  readonly roles: string[];
  /**
   * Tenant context (ADR 0014). Optional for now, and nothing reads it.
   *
   * They are what the read-path migration turns required, which is the point
   * at which the compiler starts pointing at every authorization call site
   * that has not been updated. That only works once the duplicate local
   * copies of this interface in tickets-service and users-service are
   * deleted, so making these required before then would hide the very call
   * sites the change is meant to surface.
   */
  readonly organizationId?: string;
  readonly permissions?: ReadonlySet<string>;
}

/** Staff can see and drive other people's tickets and directories. */
export function isStaff(actor: Actor): boolean {
  return actor.roles.includes('agent') || actor.roles.includes('admin');
}

/** Admins additionally read sensitive platform surfaces (audit trail). */
export function isAdmin(actor: Actor): boolean {
  return actor.roles.includes('admin');
}
