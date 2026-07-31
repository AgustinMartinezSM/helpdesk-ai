import type { Notification, TicketRef } from '../../domain/notification';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

export interface NotificationRepository {
  /**
   * Insert-if-absent on (userId, sourceEventId): what makes redelivered
   * events collapse into the notification they already produced.
   *
   * The key stays tenant-free ON PURPOSE: sourceEventId is a per-envelope
   * uuid, globally unique, so (userId, sourceEventId) cannot collide across
   * tenants. The organization column is for scoping reads, not for widening
   * the key.
   */
  add(notification: Notification): Promise<void>;
  /** Newest first, only within the given organization. */
  listForUser(
    userId: string,
    organizationId: string,
    limit: number,
  ): Promise<Notification[]>;
  /**
   * Marks one of the user's OWN notifications read; returns null when the
   * id does not exist, belongs to someone else, or belongs to another
   * organization (existence never leaks). Already-read notifications keep
   * their original readAt.
   */
  markRead(
    id: string,
    userId: string,
    organizationId: string,
    readAt: Date,
  ): Promise<Notification | null>;
}

export const TICKET_REF_REPOSITORY = Symbol('TICKET_REF_REPOSITORY');

export interface TicketRefRepository {
  upsert(ref: TicketRef): Promise<void>;
  findByTicketId(ticketId: string): Promise<TicketRef | null>;
}

export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
