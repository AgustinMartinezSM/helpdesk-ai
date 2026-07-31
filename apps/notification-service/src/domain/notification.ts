export const NOTIFICATION_TYPES = [
  'ticket-status-changed',
  'ticket-assigned',
  'ticket-comment-added',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * One in-app notification for one recipient. Messages are fixed templates
 * over event metadata — user-authored text never travels through events
 * (see docs/architecture/messaging.md), so it can never leak here.
 */
export interface Notification {
  readonly id: string;
  /** Recipient — a user id issued by auth-service. */
  readonly userId: string;
  /**
   * Tenant the event that produced this notification belonged to (ADR 0012).
   * Required here even though the column is still nullable: every write goes
   * through a v2 event whose envelope carries the organization, so a new row
   * without one is a bug, not a state.
   */
  readonly organizationId: string;
  readonly type: NotificationType;
  readonly ticketId: string;
  readonly message: string;
  /** Envelope id of the event that produced this notification (dedupe key). */
  readonly sourceEventId: string;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

/**
 * Local projection of the one slice of ticket state notifications need:
 * who requested the ticket. Fed by ticket.created.v1 and rebuildable from
 * the ticket owner's API (see docs/architecture/data-ownership.md).
 */
export interface TicketRef {
  readonly ticketId: string;
  readonly requesterId: string;
  /**
   * Tenant the ticket belongs to. Required since the phase-7 NOT NULL on the
   * column: every ref carries its organization, so a follow-up event that
   * disagrees with it is the only non-happy path left.
   */
  readonly organizationId: string;
}
