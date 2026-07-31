import { randomUUID } from 'node:crypto';
import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenTicketActionError,
  InvalidStatusTransitionError,
  TicketNotFoundError,
} from '../../domain/errors';
import {
  canTransition,
  canView,
  requireOrganizationOf,
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
    traceId?: string,
  ): Promise<Ticket> {
    const ticket = await this.tickets.findById(
      requireOrganization(actor),
      ticketId,
    );
    if (!ticket || !canView(actor, ticket)) {
      throw new TicketNotFoundError();
    }

    // change_status drives the lifecycle. The one exception is the matrix's
    // own-scope cell: a requester may close their own ticket once it is
    // resolved (confirming the fix) — enforced here as domain logic, not by
    // a permission key.
    const requesterClosingResolved =
      ticket.requesterId === actor.id &&
      ticket.status === 'resolved' &&
      to === 'closed';
    if (
      !hasPermission(actor, PERMISSIONS.TICKETS_CHANGE_STATUS) &&
      !requesterClosingResolved
    ) {
      throw new ForbiddenTicketActionError();
    }

    if (!canTransition(ticket.status, to)) {
      throw new InvalidStatusTransitionError(ticket.status, to);
    }

    const organizationId = requireOrganizationOf(actor, ticket);
    const now = this.clock.now();
    const updated: Ticket = { ...ticket, status: to, updatedAt: now };
    await this.tickets.update(updated, {
      id: randomUUID(),
      ticketId: ticket.id,
      organizationId,
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
      traceId,
      organizationId,
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
    traceId?: string,
  ): Promise<Ticket> {
    // Taking a ticket yourself and handing one to somebody else are separate
    // grants; unassigning counts as the latter — it changes someone else's
    // queue, not your own.
    const required =
      assigneeId === actor.id
        ? PERMISSIONS.TICKETS_ASSIGN_SELF
        : PERMISSIONS.TICKETS_ASSIGN_AGENT;
    if (!hasPermission(actor, required)) {
      throw new ForbiddenTicketActionError();
    }

    const ticket = await this.tickets.findById(
      requireOrganization(actor),
      ticketId,
    );
    if (!ticket) {
      throw new TicketNotFoundError();
    }

    const organizationId = requireOrganizationOf(actor, ticket);
    const now = this.clock.now();
    const updated: Ticket = { ...ticket, assigneeId, updatedAt: now };
    await this.tickets.update(updated, {
      id: randomUUID(),
      ticketId: ticket.id,
      organizationId,
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
      traceId,
      organizationId,
    });

    return updated;
  }
}
