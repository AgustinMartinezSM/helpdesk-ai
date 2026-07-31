import {
  displayNameFromEmail,
  type UserProfile,
} from '../../domain/user-profile';
import type {
  Clock,
  UserProfileRepository,
} from '../ports/user-profile.repository';

export interface RegisterUserProfileInput {
  userId: string;
  email: string;
  registeredAt: Date;
}

/**
 * Projects a user.registered.v1 event into a profile row. Idempotent:
 * delivery is at-least-once, so a duplicate event simply overwrites the
 * projection with the same data. An existing profile keeps its display
 * name (once editing exists, a replay must not undo a user's choice).
 */
export class RegisterUserProfileUseCase {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: RegisterUserProfileInput): Promise<UserProfile> {
    const existing = await this.profiles.findByUserId(input.userId);
    const now = this.clock.now();

    const profile: UserProfile = {
      userId: input.userId,
      email: input.email,
      displayName: existing?.displayName ?? displayNameFromEmail(input.email),
      registeredAt: input.registeredAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.profiles.upsert(profile);
    return profile;
  }
}
