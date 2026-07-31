import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import { ForbiddenAuditActionError } from '../../domain/errors';
import type { AuditEvent } from '../../domain/audit-event';
import type { AuditEventRepository } from '../ports/audit-event.repository';

/** What the caller may choose. The tenant is deliberately not among it. */
export interface ListAuditEventsInput {
  type?: string;
  limit: number;
  offset: number;
}

/**
 * audit.read is deliberately absent from the agent template (org_admin keeps
 * it): the trail carries every event payload, including registration events
 * with user emails — reading it is a sensitive platform capability, not a
 * support-desk one.
 */
export class ListAuditEventsUseCase {
  constructor(private readonly events: AuditEventRepository) {}

  async execute(
    actor: Actor,
    input: ListAuditEventsInput,
  ): Promise<AuditEvent[]> {
    if (!hasPermission(actor, PERMISSIONS.AUDIT_READ)) {
      throw new ForbiddenAuditActionError();
    }
    // The permission says the trail is readable; the token's organization
    // says which slice. The controller builds type/limit/offset and nothing
    // else — the tenant never comes from the caller's query.
    return this.events.list({
      organizationId: requireOrganization(actor),
      type: input.type,
      limit: input.limit,
      offset: input.offset,
    });
  }
}
