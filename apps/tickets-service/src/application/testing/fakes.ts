import { PERMISSIONS } from '@helpdesk-ai/security';
import type {
  Ticket,
  TicketComment,
  TicketHistoryEntry,
} from '../../domain/ticket';
import type {
  EventPublisher,
  TicketAssignedEvent,
  TicketCommentAddedEvent,
  TicketCreatedEvent,
  TicketStatusChangedEvent,
} from '../ports/event-publisher';
import type {
  AssigneeMembership,
  MembershipVerifier,
} from '../ports/membership-verifier';
import {
  ACTIVE_REF_STATUS,
  type ApplyBranchRef,
  type ApplyStationRef,
  type BranchRef,
  type BranchRefRepository,
  type StationRef,
  type StationRefRepository,
} from '../ports/structure-refs.repository';
import type {
  Clock,
  TicketListFilter,
  TicketPage,
  TicketRepository,
} from '../ports/ticket.repository';

/** Deterministic in-memory test doubles for the application layer. */

export class InMemoryTicketRepository implements TicketRepository {
  readonly tickets = new Map<string, Ticket>();
  readonly comments: TicketComment[] = [];
  readonly history: TicketHistoryEntry[] = [];

  async create(ticket: Ticket, history: TicketHistoryEntry): Promise<void> {
    this.tickets.set(ticket.id, ticket);
    this.history.push(history);
  }

  async findById(organizationId: string, id: string): Promise<Ticket | null> {
    // The fake enforces the scope for real. A double that ignored it would
    // let every unit test pass against a repository that leaks, which is the
    // exact failure the phase 0 assertions were written to catch.
    const ticket = this.tickets.get(id);
    return ticket && ticket.organizationId === organizationId ? ticket : null;
  }

  async list(filter: TicketListFilter): Promise<TicketPage> {
    const all = [...this.tickets.values()]
      .filter((t) => t.organizationId === filter.organizationId)
      .filter(
        (t) => !filter.requesterId || t.requesterId === filter.requesterId,
      )
      .filter((t) => !filter.assigneeId || t.assigneeId === filter.assigneeId)
      .filter((t) => !filter.status || t.status === filter.status)
      .filter((t) => !filter.branchId || t.branchId === filter.branchId)
      // The whole visibility predicate, enforced for real (R2): branch in
      // the set OR the caller's own row. A branchless ticket fails the
      // IN-set leg, exactly like NULL does in SQL.
      .filter(
        (t) =>
          !filter.branchScope ||
          (t.branchId !== null &&
            filter.branchScope.branchIds.includes(t.branchId)) ||
          t.requesterId === filter.branchScope.requesterId,
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return {
      items: all.slice(filter.skip, filter.skip + filter.take),
      total: all.length,
    };
  }

  async update(ticket: Ticket, history: TicketHistoryEntry): Promise<void> {
    this.tickets.set(ticket.id, ticket);
    this.history.push(history);
  }

  async addComment(
    comment: TicketComment,
    history: TicketHistoryEntry,
  ): Promise<void> {
    this.comments.push(comment);
    this.history.push(history);
  }

  async commentsFor(
    ticketId: string,
    includeInternal: boolean,
  ): Promise<TicketComment[]> {
    return this.comments.filter(
      (c) => c.ticketId === ticketId && (includeInternal || !c.internal),
    );
  }

  async historyFor(
    ticketId: string,
    includeInternal: boolean,
  ): Promise<TicketHistoryEntry[]> {
    return this.history.filter(
      (h) =>
        h.ticketId === ticketId &&
        (includeInternal ||
          !(h.action === 'comment_added' && h.detail === 'internal')),
    );
  }
}

export class FakeEventPublisher implements EventPublisher {
  readonly created: TicketCreatedEvent[] = [];
  readonly statusChanged: TicketStatusChangedEvent[] = [];
  readonly assigned: TicketAssignedEvent[] = [];
  readonly commentsAdded: TicketCommentAddedEvent[] = [];

  async publishTicketCreated(event: TicketCreatedEvent): Promise<void> {
    this.created.push(event);
  }

  async publishTicketStatusChanged(
    event: TicketStatusChangedEvent,
  ): Promise<void> {
    this.statusChanged.push(event);
  }

  async publishTicketAssigned(event: TicketAssignedEvent): Promise<void> {
    this.assigned.push(event);
  }

  async publishTicketCommentAdded(
    event: TicketCommentAddedEvent,
  ): Promise<void> {
    this.commentsAdded.push(event);
  }
}

export class FakeMembershipVerifier implements MembershipVerifier {
  /** Membership rows keyed by organization, then user — like the real data. */
  private readonly rows = new Map<string, AssigneeMembership>();
  /** Every lookup made, so tests can assert the verifier was (not) asked. */
  readonly lookups: Array<{ organizationId: string; userId: string }> = [];
  /** When set, every lookup throws it — the infrastructure-down case. */
  failure: Error | null = null;

  /** Registers a membership; defaults model an active agent in a live org. */
  set(
    organizationId: string,
    userId: string,
    overrides: Partial<AssigneeMembership> = {},
  ): void {
    this.rows.set(`${organizationId}:${userId}`, {
      status: 'active',
      roleTemplate: 'agent',
      permissions: [
        PERMISSIONS.TICKETS_ASSIGN_SELF,
        PERMISSIONS.TICKETS_ASSIGN_AGENT,
      ],
      organizationStatus: 'active',
      ...overrides,
    });
  }

  async findInOrganization(
    organizationId: string,
    userId: string,
  ): Promise<AssigneeMembership | null> {
    this.lookups.push({ organizationId, userId });
    if (this.failure) {
      throw this.failure;
    }
    // Missing key answers null exactly like the adapter's 404: a foreign
    // user has no row under this organization, same as a guessed id.
    return this.rows.get(`${organizationId}:${userId}`) ?? null;
  }
}

/**
 * Mirrors the SQL semantics exactly (LWW guard with <=, whole-row replace on
 * a win) so specs exercise the same rules the real repository enforces
 * atomically — and enforces the organization scope for real (R2): a foreign
 * branch answers null exactly like a missing one, so a unit test cannot pass
 * against a projection that leaks.
 */
export class InMemoryBranchRefRepository implements BranchRefRepository {
  readonly rows = new Map<string, BranchRef>();

  /** Seeds a projected row directly, bypassing the LWW guard — arranging. */
  seed(ref: BranchRef): void {
    this.rows.set(ref.id, ref);
  }

  async apply(input: ApplyBranchRef): Promise<void> {
    const existing = this.rows.get(input.branchId);
    if (existing && !(existing.updatedAt <= input.occurredAt)) {
      // Stale replay loses; GREATEST keeps the newer updated_at untouched.
      return;
    }
    this.rows.set(input.branchId, {
      id: input.branchId,
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      status: input.status,
      updatedAt: input.occurredAt,
    });
  }

  async findActive(
    organizationId: string,
    branchId: string,
  ): Promise<BranchRef | null> {
    const row = this.rows.get(branchId);
    return row &&
      row.organizationId === organizationId &&
      row.status === ACTIVE_REF_STATUS
      ? row
      : null;
  }

  async listActive(organizationId: string): Promise<BranchRef[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          row.status === ACTIVE_REF_STATUS,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** The station projection double, under the same R2 discipline. */
export class InMemoryStationRefRepository implements StationRefRepository {
  readonly rows = new Map<string, StationRef>();

  /** Seeds a projected row directly, bypassing the LWW guard — arranging. */
  seed(ref: StationRef): void {
    this.rows.set(ref.id, ref);
  }

  async apply(input: ApplyStationRef): Promise<void> {
    const existing = this.rows.get(input.stationId);
    if (existing && !(existing.updatedAt <= input.occurredAt)) {
      return;
    }
    this.rows.set(input.stationId, {
      id: input.stationId,
      branchId: input.branchId,
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      area: input.area,
      status: input.status,
      updatedAt: input.occurredAt,
    });
  }

  async findActive(
    organizationId: string,
    branchId: string,
    stationId: string,
  ): Promise<StationRef | null> {
    const row = this.rows.get(stationId);
    // Branch AND organization, like the real predicate: a station of
    // another branch answers null exactly like a guessed id.
    return row &&
      row.organizationId === organizationId &&
      row.branchId === branchId &&
      row.status === ACTIVE_REF_STATUS
      ? row
      : null;
  }

  async listActive(
    organizationId: string,
    branchId: string,
  ): Promise<StationRef[]> {
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.organizationId === organizationId &&
          row.branchId === branchId &&
          row.status === ACTIVE_REF_STATUS,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
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
