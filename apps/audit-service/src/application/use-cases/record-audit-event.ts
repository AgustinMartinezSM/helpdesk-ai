import { requireEnvelopeOrganization } from '@helpdesk-ai/messaging';
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
  organizationId?: string;
  payload: unknown;
}

/**
 * Whether an event type is expected to carry its tenant on the envelope.
 * Two halves, matching how tenancy reached the bus:
 *
 * - A version suffix of `.v2` or higher: v2 is the tenant-carrying revision
 *   of every contract that had a tenantless v1, and later versions keep the
 *   field — dropping it again would be the break v2 exists to avoid.
 * - `membership.*`: born tenant-carrying, so their ".v1" names the first
 *   version of a tenant-carrying contract, not a tenantless past (see the
 *   comment above membershipCreatedV1 in @helpdesk-ai/messaging contracts).
 *
 * Types with no version suffix fall outside the rule: the firehose records
 * events it has no contract for and cannot demand a tenant nobody agreed on.
 */
export function isTenantCarryingEventType(type: string): boolean {
  if (type.startsWith('membership.')) {
    return true;
  }
  const version = /\.v(\d+)$/.exec(type);
  return version !== null && Number(version[1]) >= 2;
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
    // A tenant-carrying type must arrive with its tenant: the throw rejects
    // the delivery to the DLQ, an inspectable dead letter instead of a row
    // no organization owns. v1 envelopes keep recording with null — the
    // trail archives the compatibility window as it actually happened.
    const organizationId = isTenantCarryingEventType(envelope.type)
      ? requireEnvelopeOrganization(envelope)
      : (envelope.organizationId ?? null);

    const record: AuditEvent = {
      id: envelope.id,
      type: envelope.type,
      occurredAt: new Date(envelope.occurredAt),
      correlationId: envelope.correlationId ?? null,
      organizationId,
      payload: envelope.payload,
      recordedAt: this.clock.now(),
    };
    await this.events.record(record);
    return record;
  }
}
