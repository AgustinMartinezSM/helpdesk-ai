import {
  LOST_CREATED_ROLE_TEMPLATE,
  type DirectoryMembership,
} from '../../domain/directory-membership';
import type { FieldDefinition, FieldValue } from '../../domain/profile-fields';
import type {
  PersonProfilePatch,
  UserProfile,
} from '../../domain/user-profile';
import type { FieldDefinitionRepository } from '../ports/field-definition.repository';
import type { FieldValueRepository } from '../ports/field-value.repository';
import type {
  ApplyMembershipCreated,
  ApplyMembershipRoleChanged,
  ApplyMembershipStatusChanged,
  MembershipProjectionRepository,
} from '../ports/membership-projection.repository';
import type {
  ProfileEventPublisher,
  ProfileUpdatedNotification,
} from '../ports/profile-event.publisher';
import type {
  Clock,
  IdGenerator,
  DirectoryEntry,
  UserProfileRepository,
} from '../ports/user-profile.repository';

/** Deterministic in-memory test doubles for the application layer. */

/**
 * Mirrors the SQL semantics exactly (LWW guard with <=, requester-shaped
 * insert on a lost created event, role-changed skipping unknown edges) so
 * use-case specs exercise the same rules the real repository enforces
 * atomically.
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

  async applyRoleChanged(input: ApplyMembershipRoleChanged): Promise<boolean> {
    const key = this.key(input.organizationId, input.userId);
    const existing = this.rows.get(key);
    if (!existing) {
      // Skip, never create (see the port contract): a template without a
      // status is a guess in both directions.
      return false;
    }
    const wins = existing.updatedAt <= input.occurredAt;
    this.rows.set(key, {
      ...existing,
      roleTemplate: wins ? input.toTemplate : existing.roleTemplate,
      updatedAt: new Date(
        Math.max(existing.updatedAt.getTime(), input.occurredAt.getTime()),
      ),
    });
    return true;
  }

  /**
   * Read side the profile fake scopes its listing with. Returns the role
   * template alongside the id because the real query reads both from the same
   * row — a fake that returned only ids would let the directory's role column
   * be wrong without any spec noticing.
   */
  activeMembers(organizationId: string): Map<string, string> {
    const members = new Map<string, string>();
    for (const row of this.rows.values()) {
      if (row.organizationId === organizationId && row.status === 'active') {
        members.set(row.userId, row.roleTemplate);
      }
    }
    return members;
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

  async findMember(
    organizationId: string,
    userId: string,
  ): Promise<UserProfile | null> {
    // Same null for a foreign user, an inactive member and a stranger —
    // mirroring the scoped SQL, so a spec cannot pass on an unscoped stub.
    if (!this.memberships.activeMembers(organizationId).has(userId)) {
      return null;
    }
    return this.profiles.get(userId) ?? null;
  }

  async upsert(profile: UserProfile): Promise<void> {
    const existing = this.profiles.get(profile.userId);
    if (!existing) {
      this.profiles.set(profile.userId, profile);
      return;
    }
    // Mirrors the SQL update arm exactly (ADR 0018): a replayed
    // registration refreshes the identity seed and nothing else.
    this.profiles.set(profile.userId, {
      ...existing,
      email: profile.email,
      registeredAt: profile.registeredAt,
      updatedAt: profile.updatedAt,
    });
  }

  async updateProfile(
    userId: string,
    patch: PersonProfilePatch,
    updatedAt: Date,
  ): Promise<void> {
    const existing = this.profiles.get(userId);
    if (!existing) {
      throw new Error(`no profile for ${userId} — mirror of Prisma's P2025`);
    }
    this.profiles.set(userId, {
      ...existing,
      ...(patch.displayName !== undefined
        ? { displayName: patch.displayName }
        : {}),
      ...(patch.preferredName !== undefined
        ? { preferredName: patch.preferredName }
        : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.timezone !== undefined ? { timezone: patch.timezone } : {}),
      updatedAt,
    });
  }

  async list(organizationId: string): Promise<DirectoryEntry[]> {
    const members = this.memberships.activeMembers(organizationId);
    return [...this.profiles.values()]
      .filter((profile) => members.has(profile.userId))
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .map((profile) => ({
        profile,
        roleTemplate: members.get(profile.userId) ?? 'requester',
      }));
  }
}

/**
 * Enforces the organization scope for real (R2): a definition created under
 * one organization is null under any other, and the (organization, key)
 * uniqueness is checked the way the SQL index would.
 */
export class InMemoryFieldDefinitionRepository implements FieldDefinitionRepository {
  readonly rows = new Map<string, FieldDefinition>();

  async create(definition: FieldDefinition): Promise<FieldDefinition | null> {
    const duplicate = [...this.rows.values()].some(
      (row) =>
        row.organizationId === definition.organizationId &&
        row.key === definition.key,
    );
    if (duplicate) {
      return null;
    }
    this.rows.set(definition.id, definition);
    return definition;
  }

  async update(definition: FieldDefinition): Promise<void> {
    const existing = this.rows.get(definition.id);
    if (!existing) {
      throw new Error(`no definition ${definition.id} — mirror of P2025`);
    }
    // key and type stay as stored, mirroring the adapter's UPDATE column
    // list: immutability holds even against a caller that forgets to check.
    this.rows.set(definition.id, {
      ...definition,
      key: existing.key,
      type: existing.type,
    });
  }

  async list(
    organizationId: string,
    includeArchived = false,
  ): Promise<FieldDefinition[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          (includeArchived || row.status === 'active'),
      )
      .sort(
        (a, b) => a.displayOrder - b.displayOrder || a.key.localeCompare(b.key),
      );
  }

  async findById(
    organizationId: string,
    id: string,
  ): Promise<FieldDefinition | null> {
    const row = this.rows.get(id);
    return row && row.organizationId === organizationId ? row : null;
  }

  async findByKey(
    organizationId: string,
    key: string,
  ): Promise<FieldDefinition | null> {
    return (
      [...this.rows.values()].find(
        (row) => row.organizationId === organizationId && row.key === key,
      ) ?? null
    );
  }
}

/** Values keyed like the SQL PK; org scope enforced on every read (R2). */
export class InMemoryFieldValueRepository implements FieldValueRepository {
  readonly rows = new Map<string, FieldValue>();

  private key(fieldId: string, userId: string): string {
    return `${fieldId}:${userId}`;
  }

  async find(fieldId: string, userId: string): Promise<FieldValue | null> {
    return this.rows.get(this.key(fieldId, userId)) ?? null;
  }

  async upsert(value: FieldValue): Promise<void> {
    this.rows.set(this.key(value.fieldId, value.userId), value);
  }

  async delete(fieldId: string, userId: string): Promise<boolean> {
    return this.rows.delete(this.key(fieldId, userId));
  }

  async listForUser(
    organizationId: string,
    userId: string,
  ): Promise<FieldValue[]> {
    return [...this.rows.values()].filter(
      (row) => row.organizationId === organizationId && row.userId === userId,
    );
  }

  async listForUsers(
    organizationId: string,
    userIds: string[],
  ): Promise<FieldValue[]> {
    const wanted = new Set(userIds);
    return [...this.rows.values()].filter(
      (row) => row.organizationId === organizationId && wanted.has(row.userId),
    );
  }
}

/** Captures outbound profile events so specs can pin keys-only payloads. */
export class CapturingProfileEventPublisher implements ProfileEventPublisher {
  readonly published: ProfileUpdatedNotification[] = [];

  async profileUpdated(
    notification: ProfileUpdatedNotification,
  ): Promise<void> {
    this.published.push(notification);
  }
}

/** Deterministic ids: seq-0, seq-1, ... or a fixed list when provided. */
export class SequenceIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly fixed: string[] = []) {}

  next(): string {
    const id =
      this.fixed[this.counter] ??
      `00000000-0000-4000-8000-${String(this.counter).padStart(12, '0')}`;
    this.counter += 1;
    return id;
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
