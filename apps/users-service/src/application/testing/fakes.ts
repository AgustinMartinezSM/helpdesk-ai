import {
  LOST_CREATED_ROLE_TEMPLATE,
  type DirectoryMembership,
} from '../../domain/directory-membership';
import type { UserProfile } from '../../domain/user-profile';
import type {
  ApplyMembershipCreated,
  ApplyMembershipStatusChanged,
  MembershipProjectionRepository,
} from '../ports/membership-projection.repository';
import type {
  Clock,
  UserProfileRepository,
} from '../ports/user-profile.repository';

/** Deterministic in-memory test doubles for the application layer. */

/**
 * Mirrors the SQL semantics exactly (LWW guard with <=, requester-shaped
 * insert on a lost created event) so use-case specs exercise the same rules
 * the real repository enforces atomically.
 */
export class InMemoryMembershipProjectionRepository implements MembershipProjectionRepository {
  readonly rows = new Map<string, DirectoryMembership>();

  private key(organizationId: string, userId: string): string {
    return `${organizationId}:${userId}`;
  }

  async applyCreated(input: ApplyMembershipCreated): Promise<void> {
    const key = this.key(input.organizationId, input.userId);
    const existing = this.rows.get(key);
    if (!existing) {
      this.rows.set(key, {
        organizationId: input.organizationId,
        userId: input.userId,
        roleTemplate: input.roleTemplate,
        status: input.status,
        updatedAt: input.occurredAt,
      });
      return;
    }
    const wins = existing.updatedAt <= input.occurredAt;
    this.rows.set(key, {
      ...existing,
      roleTemplate: wins ? input.roleTemplate : existing.roleTemplate,
      status: wins ? input.status : existing.status,
      updatedAt: new Date(
        Math.max(existing.updatedAt.getTime(), input.occurredAt.getTime()),
      ),
    });
  }

  async applyStatusChanged(input: ApplyMembershipStatusChanged): Promise<void> {
    const key = this.key(input.organizationId, input.userId);
    const existing = this.rows.get(key);
    if (!existing) {
      this.rows.set(key, {
        organizationId: input.organizationId,
        userId: input.userId,
        roleTemplate: LOST_CREATED_ROLE_TEMPLATE,
        status: input.toStatus,
        updatedAt: input.occurredAt,
      });
      return;
    }
    const wins = existing.updatedAt <= input.occurredAt;
    this.rows.set(key, {
      ...existing,
      status: wins ? input.toStatus : existing.status,
      updatedAt: new Date(
        Math.max(existing.updatedAt.getTime(), input.occurredAt.getTime()),
      ),
    });
  }

  /** Read side the profile fake scopes its listing with. */
  activeUserIds(organizationId: string): Set<string> {
    const ids = new Set<string>();
    for (const row of this.rows.values()) {
      if (row.organizationId === organizationId && row.status === 'active') {
        ids.add(row.userId);
      }
    }
    return ids;
  }
}

export class InMemoryUserProfileRepository implements UserProfileRepository {
  readonly profiles = new Map<string, UserProfile>();

  constructor(
    // The fake enforces the tenant scope for real, against the same
    // membership fake the apply use cases write: a spec that forgets to
    // create a membership sees an empty directory, exactly like production
    // would, instead of passing on an unscoped stub.
    readonly memberships = new InMemoryMembershipProjectionRepository(),
  ) {}

  async findByUserId(userId: string): Promise<UserProfile | null> {
    return this.profiles.get(userId) ?? null;
  }

  async upsert(profile: UserProfile): Promise<void> {
    this.profiles.set(profile.userId, profile);
  }

  async list(organizationId: string): Promise<UserProfile[]> {
    const activeIds = this.memberships.activeUserIds(organizationId);
    return [...this.profiles.values()]
      .filter((profile) => activeIds.has(profile.userId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
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
