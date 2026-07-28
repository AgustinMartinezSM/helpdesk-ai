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
    toStatus: string;
    changedAt: Date;
    occurredAt: Date;
  }): Promise<void> {
    await this.snapshots.applyStatusChanged(input);
  }
}

export class ApplyUserRegisteredUseCase {
  constructor(private readonly users: UserSnapshotRepository) {}

  async execute(input: { userId: string; registeredAt: Date }): Promise<void> {
    await this.users.applyRegistered(input);
  }
}
