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
          payload: event.payload as Prisma.InputJsonValue,
          recordedAt: event.recordedAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  async list(filter: AuditEventListFilter): Promise<AuditEvent[]> {
    const rows = await this.prisma.auditEvent.findMany({
      where: filter.type ? { type: filter.type } : undefined,
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
    payload: row.payload,
    recordedAt: row.recordedAt,
  };
}
