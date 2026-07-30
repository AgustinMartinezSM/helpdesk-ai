import type { TicketPriority, TicketStatus } from '../../domain/ticket';

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');

/**
 * Request correlation carried alongside an event, never inside its payload.
 *
 * Without it an audit row cannot be joined back to the request that caused
 * it: the trail records the envelope, and until now every envelope reached
 * the broker with a null correlationId. This is the id that closes that gap,
 * so it is deliberately optional — a missing trace must never stop a domain
 * event from being published.
 */
export interface EventCorrelation {
  readonly traceId?: string;
  /**
   * Tenant the acting caller belongs to, stamped on the v2 envelope.
   *
   * Optional for the same reason `traceId` is: a missing one must never stop
   * a domain event from being published. What it does stop is the v2 copy —
   * a v2 event without a tenant is the thing the whole migration exists to
   * make impossible, so the adapter skips it and says so.
   *
   * This is the caller's organization, not the ticket's. They cannot differ
   * today because a caller only reaches tickets they may see, but nothing
   * enforces that here, and the two become separable when tickets get their
   * own organization column.
   */
  readonly organizationId?: string;
}

export interface TicketCreatedEvent extends EventCorrelation {
  ticketId: string;
  requesterId: string;
  title: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: Date;
}

export interface TicketStatusChangedEvent extends EventCorrelation {
  ticketId: string;
  actorId: string;
  fromStatus: TicketStatus;
  toStatus: TicketStatus;
  changedAt: Date;
}

export interface TicketAssignedEvent extends EventCorrelation {
  ticketId: string;
  actorId: string;
  /** Null means the ticket was unassigned. */
  assigneeId: string | null;
  assignedAt: Date;
}

export interface TicketCommentAddedEvent extends EventCorrelation {
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
