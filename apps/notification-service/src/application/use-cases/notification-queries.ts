import { requireOrganization, type Actor } from '@helpdesk-ai/security';
import { NotificationNotFoundError } from '../../domain/errors';
import type { Notification } from '../../domain/notification';
import type {
  Clock,
  NotificationRepository,
} from '../ports/notification.repository';

export class ListMyNotificationsUseCase {
  constructor(private readonly notifications: NotificationRepository) {}

  async execute(actor: Actor, limit: number): Promise<Notification[]> {
    const organizationId = requireOrganization(actor);
    return this.notifications.listForUser(actor.id, organizationId, limit);
  }
}

export class MarkNotificationReadUseCase {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly clock: Clock,
  ) {}

  /**
   * 404 covers "not there", "not yours" and "not this organization" alike —
   * existence never leaks, across users or across tenants.
   */
  async execute(actor: Actor, notificationId: string): Promise<Notification> {
    const organizationId = requireOrganization(actor);
    const updated = await this.notifications.markRead(
      notificationId,
      actor.id,
      organizationId,
      this.clock.now(),
    );
    if (!updated) {
      throw new NotificationNotFoundError();
    }
    return updated;
  }
}
