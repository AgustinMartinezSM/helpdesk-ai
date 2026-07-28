import type { UserProfile } from '../../domain/user-profile';
import type {
  Clock,
  UserProfileRepository,
} from '../ports/user-profile.repository';

/** Deterministic in-memory test doubles for the application layer. */

export class InMemoryUserProfileRepository implements UserProfileRepository {
  readonly profiles = new Map<string, UserProfile>();

  async findByUserId(userId: string): Promise<UserProfile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async upsert(profile: UserProfile): Promise<void> {
    this.profiles.set(profile.userId, profile);
  }

  async list(): Promise<UserProfile[]> {
    return [...this.profiles.values()].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
