import type { UserProfile } from '../../domain/user-profile';

export const USER_PROFILE_REPOSITORY = Symbol('USER_PROFILE_REPOSITORY');

export interface UserProfileRepository {
  findByUserId(userId: string): Promise<UserProfile | null>;
  /**
   * Insert or replace by userId. Upsert semantics are what make the
   * event consumer idempotent under at-least-once delivery.
   */
  upsert(profile: UserProfile): Promise<void>;
  /** All profiles, ordered by display name. Pagination arrives with demand. */
  list(): Promise<UserProfile[]>;
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
