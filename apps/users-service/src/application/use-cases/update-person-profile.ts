import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenProfileActionError,
  ProfileNotFoundError,
} from '../../domain/errors';
import {
  PERSON_PROFILE_KEYS,
  type PersonProfileKey,
  type PersonProfilePatch,
  type UserProfile,
} from '../../domain/user-profile';
import type { ProfileEventPublisher } from '../ports/profile-event.publisher';
import type {
  Clock,
  UserProfileRepository,
} from '../ports/user-profile.repository';

/**
 * Shared core of both person-level edits: reduce the patch to the keys that
 * actually change the stored row, write only those, and announce only those
 * (no write and no event when nothing changed). The event carries the
 * acting context's organization when it has one and omits it otherwise —
 * D6: the belongs-nowhere state legitimately edits their own phone.
 */
async function applyPersonPatch(
  profiles: UserProfileRepository,
  clock: Clock,
  events: ProfileEventPublisher,
  profile: UserProfile,
  patch: PersonProfilePatch,
  organizationId: string | undefined,
): Promise<UserProfile> {
  const effective: PersonProfilePatch = {};
  const changedKeys: PersonProfileKey[] = [];
  for (const key of PERSON_PROFILE_KEYS) {
    const next = patch[key];
    if (next !== undefined && next !== profile[key]) {
      // displayName's non-null constraint is the DTO's to enforce; here the
      // key set alone decides what a person edit may touch.
      (effective as Record<string, string | null>)[key] = next;
      changedKeys.push(key);
    }
  }
  if (changedKeys.length === 0) {
    return profile;
  }

  const now = clock.now();
  await profiles.updateProfile(profile.userId, effective, now);
  await events.profileUpdated({
    userId: profile.userId,
    changedKeys,
    updatedAt: now,
    ...(organizationId ? { organizationId } : {}),
  });
  return { ...profile, ...effective, updatedAt: now } as UserProfile;
}

/**
 * PATCH /users/me. No permission key: being yourself is the authorization,
 * and no organization either — person-level data belongs to the person, so
 * the belongs-nowhere state can fix their own name and phone (D1/D6).
 */
export class UpdateMyPersonProfileUseCase {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly clock: Clock,
    private readonly events: ProfileEventPublisher,
  ) {}

  async execute(actor: Actor, patch: PersonProfilePatch): Promise<UserProfile> {
    const profile = await this.profiles.findByUserId(actor.id);
    if (!profile) {
      throw new ProfileNotFoundError();
    }
    return applyPersonPatch(
      this.profiles,
      this.clock,
      this.events,
      profile,
      patch,
      actor.organizationId,
    );
  }
}

/**
 * PATCH /users/:userId/profile — people.update edits another member's
 * person-level fields, same whitelist as the self edit. The target must be
 * an active member of the caller's organization; a foreign or unknown one
 * answers the same not-found.
 */
export class UpdateMemberPersonProfileUseCase {
  constructor(
    private readonly profiles: UserProfileRepository,
    private readonly clock: Clock,
    private readonly events: ProfileEventPublisher,
  ) {}

  async execute(
    actor: Actor,
    targetUserId: string,
    patch: PersonProfilePatch,
  ): Promise<UserProfile> {
    if (!hasPermission(actor, PERMISSIONS.PEOPLE_UPDATE)) {
      throw new ForbiddenProfileActionError();
    }
    const organizationId = requireOrganization(actor);

    const profile = await this.profiles.findMember(
      organizationId,
      targetUserId,
    );
    if (!profile) {
      throw new ProfileNotFoundError();
    }
    return applyPersonPatch(
      this.profiles,
      this.clock,
      this.events,
      profile,
      patch,
      organizationId,
    );
  }
}
