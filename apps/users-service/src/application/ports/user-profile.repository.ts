import type {
  PersonProfilePatch,
  UserProfile,
} from '../../domain/user-profile';

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY');

export interface UserProfileRepository {
  findByUserId(userId: string): Promise<UserProfile | null>;
  /**
   * The profile of an ACTIVE member of the organization, or null. Scoped at
   * the source so a foreign user and a nonexistent one answer the same null
   * — confirming existence is the leak. The directory-membership projection
   * is the membership authority here (ADR 0014: no synchronous call out).
   */
  findMember(
    organizationId: string,
    userId: string,
  ): Promise<UserProfile | null>;
  /**
   * Insert or refresh the projected identity seed. Upsert semantics are what
   * make the event consumer idempotent under at-least-once delivery — but
   * since ADR 0018 the update arm is restricted to the identity columns
   * (email, registeredAt): a replayed registration must never overwrite the
   * API-owned profile columns, displayName included. The create arm writes
   * the full row, displayName seeded from the email.
   */
  upsert(profile: UserProfile): Promise<void>;
  /**
   * Applies a person-level edit, touching ONLY the API-owned profile
   * columns named in the patch (plus updatedAt). The identity seed is out of
   * reach by construction: the patch type cannot name email or registeredAt.
   */
  updateProfile(
    userId: string,
    patch: PersonProfilePatch,
    updatedAt: Date,
  ): Promise<void>;
  /**
   * Profiles of the organization's ACTIVE members, ordered by display name.
   * The organization is required — an unscoped listing no longer exists as
   * an operation. Active-only because suspended/deactivated/invited members
   * leave the directory until the people-management sprint decides how to
   * present them. Pagination arrives with demand.
   */
  list(organizationId: string): Promise<DirectoryEntry[]>;
}

/**
 * A directory row: the profile plus the role template the membership
 * projection holds for that person.
 *
 * No membership STATUS here, deliberately. The listing already filters to
 * active members, so a status column would say 'active' on every row —
 * a field that cannot vary is noise, not information. It arrives with the
 * increment that decides how to present suspended and invited people, which
 * is the same increment that would give them a row at all.
 */
export interface DirectoryEntry {
  readonly profile: UserProfile;
  readonly roleTemplate: string;
}

export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export const ID_GENERATOR = Symbol('ID_GENERATOR');

export interface IdGenerator {
  next(): string;
}
