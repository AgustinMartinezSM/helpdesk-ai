import { hasPermission, PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  ForbiddenProfileActionError,
  ProfileNotFoundError,
} from '../../domain/errors';
import type { UserProfile } from '../../domain/user-profile';
import type { UserProfileRepository } from '../ports/user-profile.repository';

export class GetMyProfileUseCase {
  constructor(private readonly profiles: UserProfileRepository) {}

  /**
   * The projection is eventually consistent: right after registration the
   * profile may not exist yet. Callers get a 404 and should retry.
   */
  async execute(actor: Actor): Promise<UserProfile> {
    const profile = await this.profiles.findByUserId(actor.id);
    if (!profile) {
      throw new ProfileNotFoundError();
    }
    return profile;
  }
}

export class ListUserProfilesUseCase {
  constructor(private readonly profiles: UserProfileRepository) {}

  /** people.read gates the directory: it exists for agent pickers and
   * ticket views, not for browsing colleagues. */
  async execute(actor: Actor): Promise<UserProfile[]> {
    if (!hasPermission(actor, PERMISSIONS.PEOPLE_READ)) {
      throw new ForbiddenProfileActionError();
    }
    return this.profiles.list();
  }
}
