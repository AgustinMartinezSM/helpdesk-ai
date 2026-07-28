import {
  ForbiddenProfileActionError,
  ProfileNotFoundError,
} from '../../domain/errors';
import { displayNameFromEmail, type Actor } from '../../domain/user-profile';
import { FixedClock, InMemoryUserProfileRepository } from '../testing/fakes';
import {
  GetMyProfileUseCase,
  ListUserProfilesUseCase,
} from './profile-queries';
import { RegisterUserProfileUseCase } from './register-user-profile';

const USER: Actor = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['user'],
};
const AGENT: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  roles: ['agent'],
};

const REGISTRATION = {
  userId: USER.id,
  email: 'ada.lovelace@example.com',
  roles: ['user'],
  registeredAt: new Date('2026-07-28T12:00:00.000Z'),
};

function buildContext() {
  const profiles = new InMemoryUserProfileRepository();
  const clock = new FixedClock(new Date('2026-07-28T12:00:05.000Z'));
  return {
    profiles,
    clock,
    register: new RegisterUserProfileUseCase(profiles, clock),
    getMine: new GetMyProfileUseCase(profiles),
    list: new ListUserProfilesUseCase(profiles),
  };
}

describe('displayNameFromEmail', () => {
  it('uses the local part and survives degenerate inputs', () => {
    expect(displayNameFromEmail('ada.lovelace@example.com')).toBe(
      'ada.lovelace',
    );
    expect(displayNameFromEmail('@example.com')).toBe('@example.com');
  });
});

describe('RegisterUserProfileUseCase', () => {
  it('projects a registration event into a profile', async () => {
    const ctx = buildContext();

    const profile = await ctx.register.execute(REGISTRATION);

    expect(profile).toEqual({
      userId: USER.id,
      email: 'ada.lovelace@example.com',
      displayName: 'ada.lovelace',
      roles: ['user'],
      registeredAt: REGISTRATION.registeredAt,
      createdAt: ctx.clock.now(),
      updatedAt: ctx.clock.now(),
    });
  });

  it('is idempotent under redelivery and keeps the original display name', async () => {
    const ctx = buildContext();
    const first = await ctx.register.execute(REGISTRATION);

    // Simulate a manual rename before the duplicate delivery arrives.
    await ctx.profiles.upsert({ ...first, displayName: 'Ada' });
    ctx.clock.advanceSeconds(60);

    await ctx.register.execute(REGISTRATION);

    expect(ctx.profiles.profiles.size).toBe(1);
    const stored = await ctx.profiles.findByUserId(USER.id);
    expect(stored?.displayName).toBe('Ada');
    expect(stored?.createdAt).toEqual(first.createdAt);
  });
});

describe('profile queries', () => {
  it('returns the caller profile and 404s before projection', async () => {
    const ctx = buildContext();

    await expect(ctx.getMine.execute(USER)).rejects.toBeInstanceOf(
      ProfileNotFoundError,
    );

    await ctx.register.execute(REGISTRATION);
    const profile = await ctx.getMine.execute(USER);
    expect(profile.userId).toBe(USER.id);
  });

  it('restricts the directory to staff', async () => {
    const ctx = buildContext();
    await ctx.register.execute(REGISTRATION);

    await expect(ctx.list.execute(USER)).rejects.toBeInstanceOf(
      ForbiddenProfileActionError,
    );

    const directory = await ctx.list.execute(AGENT);
    expect(directory.map((p) => p.userId)).toEqual([USER.id]);
  });
});
