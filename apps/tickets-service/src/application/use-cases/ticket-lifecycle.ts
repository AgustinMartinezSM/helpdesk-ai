import { randomUUID } from 'node:crypto';
import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenTicketActionError,
  InvalidAssigneeError,
  InvalidStatusTransitionError,
  MembershipVerificationUnavailableError,
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
import type {
  AssigneeMembership,
  MembershipVerifier,
} from '../ports/membership-verifier';
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
    /**
     * Null when the internal call is not configured. Deliberately not
     * optional: a wiring site must say "no verifier" out loud, because the
     * use case then refuses every assignment (fail closed).
     */
    private readonly memberships: MembershipVerifier | null,
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

    // Re-validate the assignee against live membership state — including
    // self-assignment: the actor's own token can be up to one TTL stale past
    // a suspension, and this call is exactly the re-validation ADR 0014
    // reserved for high-consequence operations (see the port's doc comment).
    // Unassignment skips it because null references nobody.
    if (assigneeId !== null) {
      if (!this.memberships) {
        // Fail closed, unlike auth's degrade-open resolver: refusing an
        // assignment is recoverable, a cross-tenant assignment is not.
        throw new MembershipVerificationUnavailableError();
      }

      let membership: AssigneeMembership | null;
      try {
        membership = await this.memberships.findInOrganization(
          organizationId,
          assigneeId,
        );
      } catch {
        // 503, not 4xx: the caller's request was fine, the verification
        // dependency was not.
        throw new MembershipVerificationUnavailableError();
      }

      // One refusal for every cause — see InvalidAssigneeError. A foreign
      // user has no row under the ticket's organization, so the cross-tenant
      // case is indistinguishable from a guessed id.
      if (membership === null || membership.status !== 'active') {
        throw new InvalidAssigneeError();
      }
      if (membership.organizationStatus !== 'active') {
        throw new InvalidAssigneeError();
      }
      // The can-take-a-ticket grant doubles as the can-hold-a-ticket marker:
      // requesters and auditors lack it, agents and admins carry it.
      if (!membership.permissions.includes(PERMISSIONS.TICKETS_ASSIGN_SELF)) {
        throw new InvalidAssigneeError();
      }
    }

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
