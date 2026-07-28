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
    // notification the event already produced.
    await this.prisma.notification.createMany({
      data: [
        {
          id: notification.id,
          userId: notification.userId,
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

  async listForUser(userId: string, limit: number): Promise<Notification[]> {
    const rows = await this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toDomain);
  }

  async markRead(
    id: string,
    userId: string,
    readAt: Date,
  ): Promise<Notification | null> {
    // updateMany so a foreign id is a no-op instead of a thrown P2025;
    // the readAt: null condition keeps the first read timestamp.
    await this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt },
    });
    const row = await this.prisma.notification.findFirst({
      where: { id, userId },
    });
    return row ? toDomain(row) : null;
  }
}

export class PrismaTicketRefRepository implements TicketRefRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(ref: TicketRef): Promise<void> {
    await this.prisma.ticketRef.upsert({
      where: { ticketId: ref.ticketId },
      create: { ticketId: ref.ticketId, requesterId: ref.requesterId },
      update: { requesterId: ref.requesterId },
    });
  }

  async findByTicketId(ticketId: string): Promise<TicketRef | null> {
    const row = await this.prisma.ticketRef.findUnique({
      where: { ticketId },
    });
    return row
      ? { ticketId: row.ticketId, requesterId: row.requesterId }
      : null;
  }
}

function toDomain(row: NotificationRow): Notification {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type as NotificationType,
    ticketId: row.ticketId,
    message: row.message,
    sourceEventId: row.sourceEventId,
    readAt: row.readAt,
    createdAt: row.createdAt,
  };
}
