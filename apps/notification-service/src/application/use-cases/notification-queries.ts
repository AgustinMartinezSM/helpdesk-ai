import type { Actor } from '@helpdesk-ai/security';
import { NotificationNotFoundError } from '../../domain/errors';
import type { Notification } from '../../domain/notification';
import type {
  Clock,
  NotificationRepository,
} from '../ports/notification.repository';

export class ListMyNotificationsUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(actor: Actor, limit: number): Promise<Notification[]> {
    return this.notifications.listForUser(actor.id, limit);
  }
}

export class MarkNotificationReadUseCase {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  /** 404 covers both "not there" and "not yours" — existence never leaks. */
  async execute(actor: Actor, notificationId: string): Promise<Notification> {
    const updated = await this.notifications.markRead(
      notificationId,
      actor.id,
      this.clock.now(),
    );
    if (!updated) {
      throw new NotificationNotFoundError();
    }
    return updated;
  }
}
