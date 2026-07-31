import { hasPermission, PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import { ForbiddenAuditActionError } from '../../domain/errors';
import type { AuditEvent } from '../../domain/audit-event';
import type {
  AuditEventListFilter,
  AuditEventRepository,
} from '../ports/audit-event.repository';

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
    filter: AuditEventListFilter,
  ): Promise<AuditEvent[]> {
    if (!hasPermission(actor, PERMISSIONS.AUDIT_READ)) {
      throw new ForbiddenAuditActionError();
    }
    return this.events.list(filter);
  }
}
