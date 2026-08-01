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
 * delivery is at-least-once, so a duplicate event simply refreshes the
 * identity seed with the same data. Since ADR 0018 the table is a hybrid:
 * a replay must never undo an edit, so the API-owned profile columns are
 * carried through here AND, as the enforcement that actually matters, the
 * repository's upsert update arm is restricted to the identity columns —
 * this use case could not overwrite a profile edit even if it tried.
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
      // Seeded from the email on first sight only; user-owned afterwards.
      displayName: existing?.displayName ?? displayNameFromEmail(input.email),
      preferredName: existing?.preferredName ?? null,
      phone: existing?.phone ?? null,
      language: existing?.language ?? null,
      timezone: existing?.timezone ?? null,
      registeredAt: input.registeredAt,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    await this.profiles.upsert(profile);
    return profile;
  }
}
