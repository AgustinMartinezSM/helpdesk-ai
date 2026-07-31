import {
  userRegisteredV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type { RegisterUserProfileUseCase } from '../../application/use-cases/register-user-profile';

/** Durable queue owned by this service (see docs/architecture/messaging.md). */
export const USER_REGISTERED_QUEUE = 'users-service.user-registered';

/**
 * Subscribes the profile projection to user.registered.v1. The subscription
 * is started fire-and-forget on bootstrap: the client keeps reconnecting in
 * the background, so a broker outage delays consumption instead of blocking
 * HTTP startup — reads must stay available even when the broker is not.
 */
export class RegistrationConsumer {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly registerProfile: RegisterUserProfileUseCase,
    private readonly logger?: MessagingLogger,
  ) {}

  onApplicationBootstrap(): void {
    void this.start()
      .then(() => {
        this.logger?.log(
          `consuming ${userRegisteredV1.type} from ${USER_REGISTERED_QUEUE}`,
        );
      })
      .catch((error: unknown) => {
        this.logger?.error(
          `failed to start the ${USER_REGISTERED_QUEUE} subscription: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /** Resolves once the queue is declared, bound and being consumed. */
  async start(): Promise<void> {
    await this.messaging.subscribe({
      queue: USER_REGISTERED_QUEUE,
      contracts: [userRegisteredV1],
      handler: async (event) => {
        // payload.roles is deliberately ignored: the contract still carries
        // it, but the projection stopped storing roles in phase 8.
        await this.registerProfile.execute({
          userId: event.payload.userId,
          email: event.payload.email,
          registeredAt: new Date(event.payload.registeredAt),
        });
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }
}
