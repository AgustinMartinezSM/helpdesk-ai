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

export class ApplyUserRegisteredUseCase {
  constructor(private readonly users: UserSnapshotRepository) {}

  async execute(input: { userId: string; registeredAt: Date }): Promise<void> {
    await this.users.applyRegistered(input);
  }
}

/**
 * Stamps the tenant onto the user's snapshot when a membership is created.
 * Creating the row when registration never arrived (or is still in flight)
 * is deliberate: a lost registration event must not lose the member from
 * the organization's count. registeredAt is then the membership time — the
 * honest nearby value — and applyRegistered's do-nothing-on-conflict will
 * not overwrite it if the registration event shows up later.
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
