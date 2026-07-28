import type { Notification, TicketRef } from '../../domain/notification';
import type {
  Clock,
  NotificationRepository,
  TicketRefRepository,
} from '../ports/notification.repository';

/** Deterministic in-memory test doubles for the application layer. */

export class InMemoryNotificationRepository implements NotificationRepository {
  readonly notifications: Notification[] = [];

  async add(notification: Notification): Promise<void> {
    // Mirrors the (userId, sourceEventId) unique index with DO NOTHING.
    const duplicate = this.notifications.some(
      (existing) =>
        existing.userId === notification.userId &&
        existing.sourceEventId === notification.sourceEventId,
    );
    if (!duplicate) {
      this.notifications.push(notification);
    }
  }

  async listForUser(userId: string, limit: number): Promise<Notification[]> {
    return this.notifications
      .filter((notification) => notification.userId === userId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async markRead(
    id: string,
    userId: string,
    readAt: Date,
  ): Promise<Notification | null> {
    const index = this.notifications.findIndex(
      (notification) =>
        notification.id === id && notification.userId === userId,
    );
    if (index < 0) {
      return null;
    }
    const existing = this.notifications[index];
    const updated = { ...existing, readAt: existing.readAt ?? readAt };
    this.notifications[index] = updated;
    return updated;
  }
}

export class InMemoryTicketRefRepository implements TicketRefRepository {
  readonly refs = new Map<string, TicketRef>();

  async upsert(ref: TicketRef): Promise<void> {
    this.refs.set(ref.ticketId, ref);
  }

  async findByTicketId(ticketId: string): Promise<TicketRef | null> {
    return this.refs.get(ticketId) ?? null;
  }
}

export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return this.current;
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}
