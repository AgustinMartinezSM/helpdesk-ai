import type { TicketPriority, TicketStatus } from '../../domain/ticket';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

export interface TicketCreatedEvent {
  ticketId: string;
  requesterId: string;
  title: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: Date;
}

export interface TicketStatusChangedEvent {
  ticketId: string;
  actorId: string;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  changedAt: Date;
}

export interface TicketAssignedEvent {
  ticketId: string;
  actorId: string;
  /** Null means the ticket was unassigned. */
  assigneeId: string | null;
  assignedAt: Date;
}

export interface TicketCommentAddedEvent {
  ticketId: string;
  commentId: string;
  authorId: string;
  internal: boolean;
  addedAt: Date;
}

/**
 * Outbound domain events. Publishing is best-effort by contract: adapters
 * must never let a broker failure break the primary write that already
 * committed (there is no outbox yet — see ADR 0005).
 */
export interface EventPublisher {
  publishTicketCreated(event: TicketCreatedEvent): Promise<void>;
  publishTicketStatusChanged(event: TicketStatusChangedEvent): Promise<void>;
  publishTicketAssigned(event: TicketAssignedEvent): Promise<void>;
  publishTicketCommentAdded(event: TicketCommentAddedEvent): Promise<void>;
}
