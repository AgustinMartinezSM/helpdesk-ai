import {
  userRegisteredV1,
  type MessagingClient,
  type MessagingLogger,
} from '@helpdesk-ai/messaging';
import type { EnsureMembershipUseCase } from '../../application/use-cases/ensure-membership';

/** Durable queue owned by this service (see docs/architecture/messaging.md). */
export const USER_REGISTERED_QUEUE = 'organizations-service.user-registered';

/**
 * Gives every newly registered user a membership in the bootstrap
 * organization. Its own durable queue on the same binding key, so
 * users-service and analytics-service keep receiving the event untouched.
 *
 * The subscription is started fire-and-forget on bootstrap: the client keeps
 * reconnecting in the background, so a broker outage delays consumption
 * instead of blocking HTTP startup.
 *
 * Worth being clear about what a lost event costs here. Publishing is
 * best-effort with no outbox (ADR 0006), and unlike the projections in this
 * platform a membership cannot be rebuilt by replaying the log. A user whose
 * registration event never arrives therefore ends up with no membership and
 * no automatic path back — the operational backfill in
 * docs/architecture/data-ownership.md is that path, and it is re-runnable for
 * exactly this reason.
 */
export class RegistrationConsumer {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly ensureMembership: EnsureMembershipUseCase,
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
        await this.ensureMembership.execute({
          userId: event.payload.userId,
          roles: event.payload.roles,
          // Threaded through to membership.created.v1: the registration and
          // the membership it caused should group under one trace.
          correlationId: event.correlationId,
        });
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }
}
