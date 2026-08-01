/**
 * A user profile. HYBRID since Sprint 9.6 (ADR 0018): userId, email and
 * registeredAt remain the identity seed projected from user.registered.v1 —
 * the registration consumer owns them and may rewrite them on replay. The
 * remaining columns are source of truth owned by the HTTP API: displayName
 * is seeded once on create from the email's local part and user-owned from
 * then on, and the person-level fields below are written by nobody but the
 * profile endpoints. auth-service remains the source of truth for identity
 * and credentials; nothing here is a login identifier (ADR 0017).
 */
export interface UserProfile {
  /** Identifier issued by auth-service; a plain id, never a foreign key. */
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  /** Person-level fields (D1): null until the person sets them. */
  readonly preferredName: string | null;
  readonly phone: string | null;
  /** Interface language preference, e.g. 'es-AR'. Free text until i18n (10.8). */
  readonly language: string | null;
  readonly timezone: string | null;
  /** When the user registered, as stated by the event. */
  readonly registeredAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The self-editable person-level columns — the whitelist PATCH /users/me and
 * the admin person-edit accept, and the vocabulary profile.updated.v1 names
 * as changed keys. email is deliberately absent: editing it would be a
 * credential operation (ADR 0017), not a profile edit.
 */
export const PERSON_PROFILE_KEYS = [
  'displayName',
  'preferredName',
  'phone',
  'language',
  'timezone',
] as const;

export type PersonProfileKey = (typeof PERSON_PROFILE_KEYS)[number];

/**
 * Tri-state patch: absent leaves a column alone, null clears it, a value
 * replaces it. displayName cannot be null — the column stays NOT NULL
 * because the UI renders it everywhere — so it can change but never clear.
 */
export interface PersonProfilePatch {
  displayName?: string;
  preferredName?: string | null;
  phone?: string | null;
  language?: string | null;
  timezone?: string | null;
}

/**
 * Initial display name derived from the email's local part. Users can
 * change it through PATCH /users/me; consumers must not assume it stays
 * derived from the email.
 */
export function displayNameFromEmail(email: string): string {
  const [localPart] = email.split('@');
  return localPart || email;
}
