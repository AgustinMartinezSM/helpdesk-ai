import { randomUUID } from 'node:crypto';
import {
  MissingTicketRefError,
  TenantMismatchError,
} from '../../domain/errors';
import type {
  Notification,
  NotificationType,
  TicketRef,
} from '../../domain/notification';
import type {
  Clock,
  NotificationRepository,
  TicketRefRepository,
} from '../ports/notification.repository';

/**
 * Notification policy, one use case per consumed event. Shared rules:
 * an actor is never notified about their own action, delivery is
 * at-least-once so everything ends in the idempotent `add`, and every
 * follow-up event must agree with the stored ref about which tenant the
 * ticket belongs to before anyone is notified.
 */

export class RegisterTicketRefUseCase {
  constructor(private readonly refs: TicketRefRepository) {}

  async execute(input: {
    ticketId: string;
    requesterId: string;
    organizationId: string;
  }): Promise<void> {
    const ref: TicketRef = {
      ticketId: input.ticketId,
      requesterId: input.requesterId,
      organizationId: input.organizationId,
    };
    await this.refs.upsert(ref);
  }
}

interface NotifyDeps {
  refs: TicketRefRepository;
  notifications: NotificationRepository;
  clock: Clock;
}

/**
 * Refuses to act on an event whose organization disagrees with the ref.
 *
 * A null stored organization is the one tolerated exception: the ref
 * predates tenancy, and the event's envelope organization is verified
 * upstream by the publisher taking it from the ticket row itself — so
 * proceeding and letting the notification carry the event's organization
 * is safe, while dead-lettering every legacy ticket's follow-ups would
 * silence them for no protective gain.
 */
function verifyTenant(ref: TicketRef, organizationId: string): void {
  if (ref.organizationId !== null && ref.organizationId !== organizationId) {
    throw new TenantMismatchError(
      ref.ticketId,
      ref.organizationId,
      organizationId,
    );
  }
}

async function verifiedRefOf(
  refs: TicketRefRepository,
  ticketId: string,
  organizationId: string,
): Promise<TicketRef> {
  const ref = await refs.findByTicketId(ticketId);
  if (!ref) {
    // Throwing dead-letters the message: an absent ref means the ticket's
    // created event was lost or is still in flight, and silently dropping
    // here would lose the notification forever.
    throw new MissingTicketRefError(ticketId);
  }
  verifyTenant(ref, organizationId);
  return ref;
}

function notification(
  userId: string,
  organizationId: string,
  type: NotificationType,
  ticketId: string,
  message: string,
  sourceEventId: string,
  createdAt: Date,
): Notification {
  return {
    id: randomUUID(),
    userId,
    organizationId,
    type,
    ticketId,
    message,
    sourceEventId,
    readAt: null,
    createdAt,
  };
}

export class NotifyStatusChangedUseCase {
  constructor(private readonly deps: NotifyDeps) {}

  async execute(input: {
    sourceEventId: string;
    ticketId: string;
    organizationId: string;
    actorId: string;
    fromStatus: string;
    toStatus: string;
  }): Promise<Notification | null> {
    const ref = await verifiedRefOf(
      this.deps.refs,
      input.ticketId,
      input.organizationId,
    );
    if (input.actorId === ref.requesterId) {
      return null;
    }

    const created = notification(
      ref.requesterId,
      input.organizationId,
      'ticket-status-changed',
      input.ticketId,
      `Your ticket moved from ${input.fromStatus} to ${input.toStatus}`,
      input.sourceEventId,
      this.deps.clock.now(),
    );
    await this.deps.notifications.add(created);
    return created;
  }
}

export class NotifyAssignedUseCase {
  constructor(private readonly deps: NotifyDeps) {}

  async execute(input: {
    sourceEventId: string;
    ticketId: string;
    organizationId: string;
    actorId: string;
    assigneeId: string | null;
  }): Promise<Notification | null> {
    // Unassignments notify nobody; self-assignment is the actor's own act.
    if (!input.assigneeId || input.assigneeId === input.actorId) {
      return null;
    }

    // The ref is resolved purely for tenant comparison — the recipient stays
    // payload.assigneeId, whose membership is validated at the source
    // (tickets-service refuses invalid assignees as of this sprint). This
    // use case used to trust the payload with no lookup at all, which made
    // it the most direct cross-tenant vector. Behavior change: a missing
    // ref now throws like the other follow-ups — an assignment for a ticket
    // we never saw created is a gap to dead-letter and replay, not to guess
    // about.
    await verifiedRefOf(this.deps.refs, input.ticketId, input.organizationId);

    const created = notification(
      input.assigneeId,
      input.organizationId,
      'ticket-assigned',
      input.ticketId,
      'A ticket was assigned to you',
      input.sourceEventId,
      this.deps.clock.now(),
    );
    await this.deps.notifications.add(created);
    return created;
  }
}

export class NotifyCommentAddedUseCase {
  constructor(private readonly deps: NotifyDeps) {}

  async execute(input: {
    sourceEventId: string;
    ticketId: string;
    organizationId: string;
    authorId: string;
    internal: boolean;
  }): Promise<Notification | null> {
    // Internal notes are staff-only tooling: the requester must never even
    // learn that one exists.
    if (input.internal) {
      return null;
    }

    const ref = await verifiedRefOf(
      this.deps.refs,
      input.ticketId,
      input.organizationId,
    );
    if (input.authorId === ref.requesterId) {
      return null;
    }

    const created = notification(
      ref.requesterId,
      input.organizationId,
      'ticket-comment-added',
      input.ticketId,
      'New comment on your ticket',
      input.sourceEventId,
      this.deps.clock.now(),
    );
    await this.deps.notifications.add(created);
    return created;
  }
}
