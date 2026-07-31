import type { Membership, MembershipStatus } from '../../domain/membership';
import type { Organization } from '../../domain/organization';
import type { MembershipEventPublisher } from '../ports/event-publisher';
import type {
  MembershipCreateResult,
  MembershipRepository,
} from '../ports/membership.repository';
import type {
  Clock,
  IdGenerator,
  OrganizationRepository,
} from '../ports/organization.repository';

/** Deterministic in-memory test doubles for the application layer. */

export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly organizations = new Map<string, Organization>();

  add(organization: Organization): void {
    this.organizations.set(organization.id, organization);
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    return (
      [...this.organizations.values()].find(
        (organization) => organization.slug === slug,
      ) ?? null
    );
  }

  async findById(id: string): Promise<Organization | null> {
    return this.organizations.get(id) ?? null;
  }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  readonly memberships: Membership[] = [];

  async findByOrganizationAndUser(
    organizationId: string,
    userId: string,
  ): Promise<Membership | null> {
    return (
      this.memberships.find(
        (membership) =>
          membership.organizationId === organizationId &&
          membership.userId === userId,
      ) ?? null
    );
  }

  async listByUser(userId: string): Promise<Membership[]> {
    return this.memberships
      .filter((membership) => membership.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createIfAbsent(
    membership: Membership,
  ): Promise<MembershipCreateResult> {
    const existing = await this.findByOrganizationAndUser(
      membership.organizationId,
      membership.userId,
    );
    if (existing) {
      return { membership: existing, created: false };
    }
    this.memberships.push(membership);
    return { membership, created: true };
  }

  async changeStatus(
    membershipId: string,
    to: MembershipStatus,
    at: Date,
  ): Promise<Membership> {
    const index = this.memberships.findIndex(
      (membership) => membership.id === membershipId,
    );
    if (index < 0) {
      throw new Error(`no membership "${membershipId}" to change`);
    }
    const updated: Membership = {
      ...this.memberships[index],
      status: to,
      version: this.memberships[index].version + 1,
      updatedAt: at,
    };
    this.memberships[index] = updated;
    return updated;
  }
}

export class FakeMembershipEventPublisher implements MembershipEventPublisher {
  readonly created: { membership: Membership; correlationId?: string }[] = [];
  readonly statusChanged: {
    membership: Membership;
    fromStatus: MembershipStatus;
    correlationId?: string;
  }[] = [];

  async membershipCreated(
    membership: Membership,
    correlationId?: string,
  ): Promise<void> {
    this.created.push({ membership, correlationId });
  }

  async membershipStatusChanged(
    membership: Membership,
    fromStatus: MembershipStatus,
    correlationId?: string,
  ): Promise<void> {
    this.statusChanged.push({ membership, fromStatus, correlationId });
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

/** Sequential ids, so a spec can name the row it expects. */
export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = '00000000-0000-4000-8000-') {}

  next(): string {
    this.counter += 1;
    return `${this.prefix}${String(this.counter).padStart(12, '0')}`;
  }
}
