/**
 * Read-oriented projection of a registered user, rebuilt from
 * user.registered.v1 events. auth-service remains the source of truth for
 * identity and credentials; this profile exists so other humans can see
 * who is who (agent pickers, ticket views) without calling auth.
 */
export interface UserProfile {
  /** Identifier issued by auth-service; a plain id, never a foreign key. */
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: string[];
  /** When the user registered, as stated by the event. */
  readonly registeredAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Initial display name derived from the email's local part. Users will be
 * able to change it once profile editing exists; consumers must not assume
 * it stays derived from the email.
 */
export function displayNameFromEmail(email: string): string {
  const [localPart] = email.split('@');
  return localPart || email;
}

/** Identity claims of the caller, taken from the verified access token. */
export interface Actor {
  readonly id: string;
  readonly roles: string[];
}

export function isStaff(actor: Actor): boolean {
  return actor.roles.includes('agent') || actor.roles.includes('admin');
}
