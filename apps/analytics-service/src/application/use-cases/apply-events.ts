import type {
  TicketSnapshotRepository,
  UserSnapshotRepository,
} from '../ports/analytics.repository';

/**
 * Thin orchestration on purpose: idempotency and ordering guarantees live
 * in the repository's atomic SQL (see the port contract), so these use
 * cases only translate event payloads into apply calls.
 */

export class ApplyTicketCreatedUseCase {
  constructor(private readonly snapshots: TicketSnapshotRepository) {}

  async execute(input: {
    ticketId: string;
    organizationId: string;
    status: string;
    priority: string;
    createdAt: Date;
    occurredAt: Date;
  }): Promise<void> {
    await this.snapshots.applyCreated(input);
  }
}

export class ApplyTicketStatusChangedUseCase {
  constructor(private readonly snapshots: TicketSnapshotRepository) {}

  async execute(input: {
    ticketId: string;
    organizationId: string;
    toStatus: string;
    changedAt: Date;
    occurredAt: Date;
  }): Promise<void> {
    await this.snapshots.applyStatusChanged(input);
  }
}

/*
 * `ApplyUserRegisteredUseCase` lived here until Sprint 10.7.
 *
 * It wrote a tenantless row that every scoped aggregate then excluded, and
 * whose only purpose was to hold a registration timestamp nothing read. What
 * it actually did was make the tenant first-come-wins — and the first to come
 * was always the bootstrap membership, because organizations-service creates
 * that one while consuming the same registration event. ADR 0026.
 */

/**
 * Records that somebody joined an organization.
 *
 * One row per edge, so a person in two organizations is counted in both.
 * Sprint 10.8 gave this projection a second writer — the status arm below —
 * but not the ordering problem the pre-10.7 pair had: both write the same
 * row under one last-writer-wins guard, rather than two writers racing for a
 * column only one of them could fill.
 */
export class ApplyMembershipCreatedUseCase {
  constructor(private readonly users: UserSnapshotRepository) {}

  async execute(input: {
    userId: string;
    organizationId: string;
    status: string;
    createdAt: Date;
  }): Promise<void> {
    await this.users.applyMembershipCreated(input);
  }
}

/**
 * Records that somebody's membership changed status — which is how the
 * headcount goes DOWN (Sprint 10.8).
 *
 * Nothing consumed this contract here until now, so `totalUsers` counted
 * everybody who had ever joined and no event could lower it.
 */
export class ApplyMembershipStatusChangedUseCase {
  constructor(private readonly users: UserSnapshotRepository) {}

  async execute(input: {
    userId: string;
    organizationId: string;
    status: string;
    changedAt: Date;
  }): Promise<void> {
    await this.users.applyMembershipStatusChanged(input);
  }
}
