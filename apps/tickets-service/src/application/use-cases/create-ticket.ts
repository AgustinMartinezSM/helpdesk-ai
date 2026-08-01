import { randomUUID } from 'node:crypto';
import { requireOrganization, type Actor } from '@helpdesk-ai/security';
import { InvalidBranchError, InvalidStationError } from '../../domain/errors';
import type { Ticket, TicketPriority } from '../../domain/ticket';
import type { EventPublisher } from '../ports/event-publisher';
import type {
  BranchRefRepository,
  StationRefRepository,
} from '../ports/structure-refs.repository';
import type { Clock, TicketRepository } from '../ports/ticket.repository';

export interface CreateTicketInput {
  title: string;
  description: string;
  priority?: TicketPriority;
  category?: string;
  /** Branch this request is filed under; null and absent both mean none. */
  branchId?: string | null;
  /** Station within that branch; only meaningful alongside branchId. */
  stationId?: string | null;
}

export class CreateTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
    private readonly branches: BranchRefRepository,
    private readonly stations: StationRefRepository,
  ) {}

  async execute(
    actor: Actor,
    input: CreateTicketInput,
    traceId?: string,
  ): Promise<Ticket> {
    const organizationId = requireOrganization(actor);
    const branchId = input.branchId ?? null;
    const stationId = input.stationId ?? null;

    // A station only means something inside its branch (ADR 0016), so a
    // station without a branch is refused before any lookup — with the same
    // generic answer as a wrong station, because the refusal must not teach
    // a caller which part of their guess was wrong.
    if (stationId !== null && branchId === null) {
      throw new InvalidStationError();
    }

    if (branchId !== null) {
      // Validated against the local projection, not a synchronous call
      // (D4): creation is a hot path, so ADR 0014's mutations-may-ask
      // exception deliberately does not apply here. Fail closed: a
      // brand-new branch whose event has not projected yet is refused for
      // a moment, and that is the right direction to be wrong in — a
      // briefly-refused valid branch is a retry, a briefly-accepted
      // invalid one is a row lying about its scope.
      const branch = await this.branches.findActive(organizationId, branchId);
      if (!branch) {
        throw new InvalidBranchError();
      }
    }

    if (stationId !== null && branchId !== null) {
      // Scoped by the ticket's branch AND the caller's organization: a
      // station of another branch answers null exactly like a guessed id.
      const station = await this.stations.findActive(
        organizationId,
        branchId,
        stationId,
      );
      if (!station) {
        throw new InvalidStationError();
      }
    }

    const now = this.clock.now();
    const ticket: Ticket = {
      id: randomUUID(),
      organizationId,
      title: input.title,
      description: input.description,
      status: 'open',
      priority: input.priority ?? 'medium',
      category: input.category ?? null,
      requesterId: actor.id,
      assigneeId: null,
      branchId,
      operationalStationId: stationId,
      createdAt: now,
      updatedAt: now,
    };

    await this.tickets.create(ticket, {
      id: randomUUID(),
      ticketId: ticket.id,
      organizationId,
      actorId: actor.id,
      action: 'created',
      detail: null,
      createdAt: now,
    });

    // Deliberately WITHOUT the branch or station (D5): no consumer needs
    // them yet (branch analytics is Sprint 11.5), and adding fields to a
    // published payload is the mutation ADR 0005 forbids — when a consumer
    // needs the branch, that is a v3 contract, not a widened v2. The branch
    // lives on the ticket row and in API responses.
    await this.events.publishTicketCreated({
      ticketId: ticket.id,
      requesterId: ticket.requesterId,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
      traceId,
      // The required const, not the raw optional claim: the event contract
      // still types this possibly-undefined, but a tenantless caller was
      // already refused above, so the event carries a guaranteed value.
      organizationId,
      createdAt: now,
    });

    return ticket;
  }
}
