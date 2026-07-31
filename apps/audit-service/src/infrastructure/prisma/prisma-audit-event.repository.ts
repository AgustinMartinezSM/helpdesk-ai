import type { AuditEvent } from '../../domain/audit-event';
import type {
  AuditEventListFilter,
  AuditEventRepository,
} from '../../application/ports/audit-event.repository';
import type {
  AuditEvent as AuditEventRow,
  Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaAuditEventRepository implements AuditEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent): Promise<void> {
    // skipDuplicates compiles to ON CONFLICT DO NOTHING on the id primary
    // key: redelivered events collapse into the already-recorded row.
    await this.prisma.auditEvent.createMany({
      data: [
        {
          id: event.id,
          type: event.type,
          occurredAt: event.occurredAt,
          correlationId: event.correlationId,
          organizationId: event.organizationId,
          payload: event.payload as Prisma.InputJsonValue,
          recordedAt: event.recordedAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  async list(filter: AuditEventListFilter): Promise<AuditEvent[]> {
    // Equality on organization_id never matches NULL, so rows recorded from
    // v1-era envelopes are invisible to every tenant on purpose. The
    // operator backfill is what makes them visible again — they all belong
    // to the bootstrap organization while it is the only one.
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        organizationId: filter.organizationId,
        ...(filter.type ? { type: filter.type } : {}),
      },
      orderBy: { occurredAt: 'desc' },
      take: filter.limit,
      skip: filter.offset,
    });
    return rows.map(toDomain);
  }
}

function toDomain(row: AuditEventRow): AuditEvent {
  return {
    id: row.id,
    type: row.type,
    occurredAt: row.occurredAt,
    correlationId: row.correlationId,
    organizationId: row.organizationId,
    payload: row.payload,
    recordedAt: row.recordedAt,
  };
}
