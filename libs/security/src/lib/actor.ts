/**
 * Platform-wide authorization vocabulary, derived from the verified access
 * token claims. Extracted here when the sprint-7 services would have become
 * the third, fourth and fifth copies; tickets-service and users-service
 * still carry their original domain-local copies (migration pending).
 */
export interface Actor {
  readonly id: string;
  readonly roles: string[];
}

/** Staff can see and drive other people's tickets and directories. */
export function isStaff(actor: Actor): boolean {
  return actor.roles.includes('agent') || actor.roles.includes('admin');
}

/** Admins additionally read sensitive platform surfaces (audit trail). */
export function isAdmin(actor: Actor): boolean {
  return actor.roles.includes('admin');
}
