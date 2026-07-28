import type { AuditEvent } from '../../domain/audit-event';
import type {
  AuditEventRepository,
  Clock,
} from '../ports/audit-event.repository';

export interface IncomingEnvelope {
  id: string;
  type: string;
  occurredAt: string;
  correlationId?: string;
  payload: unknown;
}

/**
 * Records one bus event into the trail. Idempotent end to end: the
 * repository keys on the envelope id, so redelivery is a no-op.
 */
export class RecordAuditEventUseCase {
  constructor(
    private readonly events: AuditEventRepository,
    private readonly clock: Clock,
  ) {}

  async execute(envelope: IncomingEnvelope): Promise<AuditEvent> {
    const record: AuditEvent = {
      id: envelope.id,
      type: envelope.type,
      occurredAt: new Date(envelope.occurredAt),
      correlationId: envelope.correlationId ?? null,
      payload: envelope.payload,
      recordedAt: this.clock.now(),
    };
    await this.events.record(record);
    return record;
  }
}
