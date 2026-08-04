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
 * One row per edge, so a person in two organizations is counted in both. It
 * is the ONLY writer of this projection now, which is what removes every
 * ordering question the previous two-writer design had.
 */
export class ApplyMembershipCreatedUseCase {
  constructor(private readonly users: UserSnapshotRepository) {}

  async execute(input: {
    userId: string;
    organizationId: string;
    createdAt: Date;
  }): Promise<void> {
    await this.users.applyMembershipCreated(input);
  }
}
