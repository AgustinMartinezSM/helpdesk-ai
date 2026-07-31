import type { Notification, TicketRef } from '../../domain/notification';
import type { NotificationType } from '../../domain/notification';
import type {
  NotificationRepository,
  TicketRefRepository,
} from '../../application/ports/notification.repository';
import type { Notification as NotificationRow } from '../../generated/prisma/client';
import { PrismaService } from './prisma.service';

export class PrismaNotificationRepository implements NotificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async add(notification: Notification): Promise<void> {
    // skipDuplicates compiles to ON CONFLICT DO NOTHING on the
    // (userId, sourceEventId) unique index: redelivery collapses into the
    // notification the event already produced. The index deliberately does
    // NOT include the organization: sourceEventId is a per-envelope uuid,
    // globally unique, so the pair cannot collide across tenants — the
    // tenant column scopes reads, it does not widen the key.
    await this.prisma.notification.createMany({
      data: [
        {
          id: notification.id,
          userId: notification.userId,
          organizationId: notification.organizationId,
          type: notification.type,
          ticketId: notification.ticketId,
          message: notification.message,
          sourceEventId: notification.sourceEventId,
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        },
      ],
      skipDuplicates: true,
    });
  }

  async listForUser(
    userId: string,
    organizationId: string,
    limit: number,
  ): Promise<Notification[]> {
    // Rows with a NULL organization_id (written before tenancy) match no
    // caller's organization, so they stay invisible until the operator
    // backfill stamps them — invisible beats attributed to the wrong tenant.
    const rows = await this.prisma.notification.findMany({
      where: { userId, organizationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async markRead(
    id: string,
    userId: string,
    organizationId: string,
    readAt: Date,
  ): Promise<Notification | null> {
    // updateMany so a foreign id is a no-op instead of a thrown P2025;
    // the readAt: null condition keeps the first read timestamp. The
    // organization is part of the predicate: another tenant's id answers
    // null exactly like a nonexistent one.
    await this.prisma.notification.updateMany({
      where: { id, userId, organizationId, readAt: null },
      data: { readAt },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id, userId, organizationId },
    });
    return row ? toDomain(row) : null;
  }
}

export class PrismaTicketRefRepository implements TicketRefRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(ref: TicketRef): Promise<void> {
    // update sets requesterId AND organizationId: the v2 event is the
    // ticket's truth, and a replay may correct a stored value.
    await this.prisma.ticketRef.upsert({
      where: { ticketId: ref.ticketId },
      create: {
        ticketId: ref.ticketId,
        requesterId: ref.requesterId,
        organizationId: ref.organizationId,
      },
      update: {
        requesterId: ref.requesterId,
        organizationId: ref.organizationId,
      },
    });
  }

  async findByTicketId(ticketId: string): Promise<TicketRef | null> {
    const row = await this.prisma.ticketRef.findUnique({
      where: { ticketId },
    });
    return row
      ? {
          ticketId: row.ticketId,
          requesterId: row.requesterId,
          organizationId: row.organizationId,
        }
      : null;
  }
}

function toDomain(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    type: row.type as NotificationType,
    ticketId: row.ticketId,
    message: row.message,
    sourceEventId: row.sourceEventId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
