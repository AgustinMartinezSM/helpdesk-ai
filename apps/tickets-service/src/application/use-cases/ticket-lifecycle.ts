import { randomUUID } from 'node:crypto';
import {
  ForbiddenTicketActionError,
  InvalidStatusTransitionError,
  TicketNotFoundError,
} from '../../domain/errors';
import {
  canTransition,
  canView,
  isStaff,
  type Actor,
  type Ticket,
  type TicketStatus,
} from '../../domain/ticket';
import type { EventPublisher } from '../ports/event-publisher';
import type { Clock, TicketRepository } from '../ports/ticket.repository';

export class ChangeTicketStatusUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  async execute(
    actor: Actor,
    ticketId: string,
    to: TicketStatus,
  ): Promise<Ticket> {
    const ticket = await this.tickets.findById(ticketId);
    if (!ticket || !canView(actor, ticket)) {
      throw new TicketNotFoundError();
    }

    // Staff drive the lifecycle; a requester may only close their own
    // ticket once it is resolved (confirming the fix).
    const requesterClosingResolved =
      ticket.requesterId === actor.id &&
      ticket.status === 'resolved' &&
      to === 'closed';
    if (!isStaff(actor) && !requesterClosingResolved) {
      throw new ForbiddenTicketActionError();
    }

    if (!canTransition(ticket.status, to)) {
      throw new InvalidStatusTransitionError(ticket.status, to);
    }

    const now = this.clock.now();
    const updated: Ticket = { ...ticket, status: to, updatedAt: now };
    await this.tickets.update(updated, {
      id: randomUUID(),
      ticketId: ticket.id,
      actorId: actor.id,
      action: 'status_changed',
      detail: `${ticket.status} -> ${to}`,
      createdAt: now,
    });

    await this.events.publishTicketStatusChanged({
      ticketId: ticket.id,
      actorId: actor.id,
      fromStatus: ticket.status,
      toStatus: to,
      changedAt: now,
    });

    return updated;
  }
}

export class AssignTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  async execute(
    actor: Actor,
    ticketId: string,
    assigneeId: string | null,
  ): Promise<Ticket> {
    if (!isStaff(actor)) {
      throw new ForbiddenTicketActionError();
    }

    const ticket = await this.tickets.findById(ticketId);
    if (!ticket) {
      throw new TicketNotFoundError();
    }

    const now = this.clock.now();
    const updated: Ticket = { ...ticket, assigneeId, updatedAt: now };
    await this.tickets.update(updated, {
      id: randomUUID(),
      ticketId: ticket.id,
      actorId: actor.id,
      action: 'assigned',
      detail: assigneeId ?? 'unassigned',
      createdAt: now,
    });

    await this.events.publishTicketAssigned({
      ticketId: ticket.id,
      actorId: actor.id,
      assigneeId,
      assignedAt: now,
    });

    return updated;
  }
}
