import type { UserProfile } from '../../domain/user-profile';

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY');

export interface UserProfileRepository {
  findByUserId(userId: string): Promise<UserProfile | null>;
  /**
   * Insert or replace by userId. Upsert semantics are what make the
   * event consumer idempotent under at-least-once delivery.
   */
  upsert(profile: UserProfile): Promise<void>;
  /**
   * Profiles of the organization's ACTIVE members, ordered by display name.
   * The organization is required — an unscoped listing no longer exists as
   * an operation. Active-only because suspended/deactivated/invited members
   * leave the directory until the people-management sprint decides how to
   * present them. Pagination arrives with demand.
   */
  list(organizationId: string): Promise<UserProfile[]>;
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
