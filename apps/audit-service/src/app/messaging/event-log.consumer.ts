import type { MessagingClient, MessagingLogger } from '@helpdesk-ai/messaging';
import type { RecordAuditEventUseCase } from '../../application/use-cases/record-audit-event';

/** Durable queue owned by this service (see docs/architecture/messaging.md). */
export const EVENT_LOG_QUEUE = 'audit-service.event-log';

/**
 * Subscribes the audit trail to the whole event firehose ('#'): audit is
 * the one schema-on-read consumer, so it captures event types it has no
 * contract for, including future versions. Fire-and-forget on bootstrap:
 * a broker outage delays recording instead of blocking HTTP reads.
 */
export class EventLogConsumer {
  constructor(
    private readonly messaging: MessagingClient,
    private readonly recordEvent: RecordAuditEventUseCase,
    private readonly logger?: MessagingLogger,
  ) {}

  onApplicationBootstrap(): void {
    void this.start()
      .then(() => {
        this.logger?.log(
          `recording the event firehose from ${EVENT_LOG_QUEUE}`,
        );
      })
      .catch((error: unknown) => {
        this.logger?.error(
          `failed to start the ${EVENT_LOG_QUEUE} subscription: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  /** Resolves once the queue is declared, bound and being consumed. */
  async start(): Promise<void> {
    await this.messaging.subscribeFirehose({
      queue: EVENT_LOG_QUEUE,
      patterns: ['#'],
      handler: async (envelope) => {
        await this.recordEvent.execute(envelope);
      },
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.messaging.close();
  }
}
