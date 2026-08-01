import {
  profileUpdatedV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type {
  ProfileEventPublisher,
  ProfileUpdatedNotification,
} from '../../application/ports/profile-event.publisher';

/**
 * Publishes profile.updated.v1 to RabbitMQ.
 *
 * Best-effort delivery: the mutation already committed when this runs, so a
 * broker failure is logged and swallowed instead of failing the request.
 * Accepted trade-off until an outbox exists (ADR 0006).
 *
 * The envelope organizationId is set only when the acting context has one
 * (D6): a person-level edit by the belongs-nowhere state is a legitimate
 * publish without a tenant — exactly the user.registered.v1 shape — so
 * unlike the organizations-service adapter there IS a skip case here.
 *
 * Like that adapter, this one does not own its MessagingClient: the service
 * has a single shared client (the consumers subscribe on it) and
 * RegistrationConsumer closes it on shutdown. A second connection would
 * double the broker footprint for no isolation gain.
 */
export class RabbitMqProfileEventPublisher implements ProfileEventPublisher {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly logger?: MessagingLogger,
  ) {}

  async profileUpdated(
    notification: ProfileUpdatedNotification,
  ): Promise<void> {
    try {
      await this.messaging.publish(
        profileUpdatedV1,
        {
          userId: notification.userId,
          changedKeys: notification.changedKeys,
          updatedAt: notification.updatedAt.toISOString(),
        },
        notification.organizationId
          ? { organizationId: notification.organizationId }
          : undefined,
      );
    } catch (error) {
      this.logger?.error(
        `failed to publish ${profileUpdatedV1.type}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
