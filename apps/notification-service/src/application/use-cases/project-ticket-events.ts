import { randomUUID } from 'node:crypto';
import { MissingTicketRefError } from '../../domain/errors';
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
 * an actor is never notified about their own action, and delivery is
 * at-least-once so everything ends in the idempotent `add`.
 */

export class RegisterTicketRefUseCase {
  constructor(private readonly refs: TicketRefRepository) {}

  async execute(input: {
    ticketId: string;
    requesterId: string;
  }): Promise<void> {
    const ref: TicketRef = {
      ticketId: input.ticketId,
      requesterId: input.requesterId,
    };
    await this.refs.upsert(ref);
  }
}

interface NotifyDeps {
  refs: TicketRefRepository;
  notifications: NotificationRepository;
  clock: Clock;
}

async function requesterOf(
  refs: TicketRefRepository,
  ticketId: string,
): Promise<string> {
  const ref = await refs.findByTicketId(ticketId);
  if (!ref) {
    // Throwing dead-letters the message: an absent ref means the ticket's
    // created event was lost or is still in flight, and silently dropping
    // here would lose the notification forever.
    throw new MissingTicketRefError(ticketId);
  }
  return ref.requesterId;
}

function notification(
  userId: string,
  type: NotificationType,
  ticketId: string,
  message: string,
  sourceEventId: string,
  createdAt: Date,
): Notification {
  return {
    id: randomUUID(),
    userId,
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
    actorId: string;
    fromStatus: string;
    toStatus: string;
  }): Promise<Notification | null> {
    const requesterId = await requesterOf(this.deps.refs, input.ticketId);
    if (input.actorId === requesterId) {
      return null;
    }

    const created = notification(
      requesterId,
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
    actorId: string;
    assigneeId: string | null;
  }): Promise<Notification | null> {
    // Unassignments notify nobody; self-assignment is the actor's own act.
    if (!input.assigneeId || input.assigneeId === input.actorId) {
      return null;
    }

    const created = notification(
      input.assigneeId,
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
    authorId: string;
    internal: boolean;
  }): Promise<Notification | null> {
    // Internal notes are staff-only tooling: the requester must never even
    // learn that one exists.
    if (input.internal) {
      return null;
    }

    const requesterId = await requesterOf(this.deps.refs, input.ticketId);
    if (input.authorId === requesterId) {
      return null;
    }

    const created = notification(
      requesterId,
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
