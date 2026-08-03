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
 * Families whose ".v1" is already tenant-carrying — their first version was
 * born with the tenant, so the version-suffix rule below would wrongly let
 * them record with a null organization.
 *
 * `profile.*` is deliberately ABSENT: profile.updated.v1 is not
 * tenant-carrying by name, because a person-level edit can legitimately
 * happen with no organization (the belongs-nowhere state fixing their own
 * phone number). Adding it here would dead-letter a legitimate event.
 */
const BORN_TENANT_CARRYING_PREFIXES = [
  'membership.',
  'branch.',
  'station.',
  'invitation.',
  // Sprint 10.5. An organization IS the tenant, so an `organization.*` event
  // that arrived without one would be describing nothing — and these two say
  // the organization was renamed and that it changed hands, which are exactly
  // the facts an auditor would go looking for years later.
  'organization.',
];

/**
 * Whether an event type is expected to carry its tenant on the envelope.
 * Two halves, matching how tenancy reached the bus:
 *
 * - A version suffix of `.v2` or higher: v2 is the tenant-carrying revision
 *   of every contract that had a tenantless v1, and later versions keep the
 *   field — dropping it again would be the break v2 exists to avoid.
 * - The prefixes above: born tenant-carrying, so their ".v1" names the first
 *   version of a tenant-carrying contract, not a tenantless past (see the
 *   comment above membershipCreatedV1 in @helpdesk-ai/messaging contracts).
 *
 * Types with no version suffix fall outside the rule: the firehose records
 * events it has no contract for and cannot demand a tenant nobody agreed on.
 */
export function isTenantCarryingEventType(type: string): boolean {
  if (BORN_TENANT_CARRYING_PREFIXES.some((prefix) => type.startsWith(prefix))) {
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
