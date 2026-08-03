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
   * Profiles of the organization's members, ordered by display name. The
   * organization is required — an unscoped listing no longer exists as an
   * operation. Pagination arrives with demand.
   *
   * `statuses` names which membership statuses to include and DEFAULTS TO
   * ACTIVE ONLY (Sprint 9.10). The default is the point: this listing feeds
   * assignee pickers as well as the People screen, and quietly adding
   * suspended people to a picker would be a regression wearing a feature's
   * clothes. Only a screen that can act on them asks for more.
   */
  list(
    organizationId: string,
    statuses?: readonly string[],
  ): Promise<DirectoryEntry[]>;
}

/**
 * A directory row: the profile plus the role template and status the
 * membership projection holds for that person.
 *
 * `status` arrived in Sprint 9.10 with the surface that can change it. It was
 * deliberately absent before: the listing filtered to active members, so the
 * column would have said 'active' on every row, and a field that cannot vary
 * is noise rather than information.
 */
export interface DirectoryEntry {
  readonly profile: UserProfile;
  readonly roleTemplate: string;
  readonly status: string;
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
