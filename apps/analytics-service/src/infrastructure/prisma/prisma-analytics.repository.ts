import type { DailyCount } from '../../domain/analytics';
import type {
  ApplyMembershipCreated,
  ApplyTicketCreated,
  ApplyTicketStatusChanged,
  TicketSnapshotRepository,
  UserSnapshotRepository,
} from '../../application/ports/analytics.repository';
import { PrismaService } from './prisma.service';

export class PrismaTicketSnapshotRepository implements TicketSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Single-statement upsert with the LWW guard evaluated INSIDE Postgres:
   * two events for the same ticket applied concurrently cannot both read a
   * stale last_event_at (the row lock serializes the DO UPDATE), and an
   * older event can only backfill missing metadata, never regress status.
   * Ties (identical occurredAt) resolve to the later arrival on purpose:
   * with the per-queue serialized consumer that is publication order.
   * organization_id rides the same guard as status rather than COALESCE:
   * a v2 event is the ticket's truth and may correct a value the migration
   * backfilled to the bootstrap literal.
   */
  async applyCreated(input: ApplyTicketCreated): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO ticket_snapshots
        (ticket_id, organization_id, status, priority, created_at, resolved_at, last_event_at)
      VALUES
        (${input.ticketId}::uuid, ${input.organizationId}::uuid, ${input.status},
         ${input.priority}, ${input.createdAt}, NULL, ${input.occurredAt})
      ON CONFLICT (ticket_id) DO UPDATE SET
        priority = COALESCE(ticket_snapshots.priority, EXCLUDED.priority),
        created_at = COALESCE(ticket_snapshots.created_at, EXCLUDED.created_at),
        status = CASE
          WHEN ticket_snapshots.last_event_at <= EXCLUDED.last_event_at
          THEN EXCLUDED.status ELSE ticket_snapshots.status END,
        resolved_at = CASE
          WHEN ticket_snapshots.last_event_at <= EXCLUDED.last_event_at
          THEN EXCLUDED.resolved_at ELSE ticket_snapshots.resolved_at END,
        organization_id = CASE
          WHEN ticket_snapshots.last_event_at <= EXCLUDED.last_event_at
          THEN EXCLUDED.organization_id ELSE ticket_snapshots.organization_id END,
        last_event_at = GREATEST(ticket_snapshots.last_event_at, EXCLUDED.last_event_at)
    `;
  }

  async applyStatusChanged(input: ApplyTicketStatusChanged): Promise<void> {
    const resolvedAt = input.toStatus === 'resolved' ? input.changedAt : null;
    await this.prisma.$executeRaw`
      INSERT INTO ticket_snapshots
        (ticket_id, organization_id, status, priority, created_at, resolved_at, last_event_at)
      VALUES
        (${input.ticketId}::uuid, ${input.organizationId}::uuid, ${input.toStatus},
         NULL, NULL, ${resolvedAt}, ${input.occurredAt})
      ON CONFLICT (ticket_id) DO UPDATE SET
        status = CASE
          WHEN ticket_snapshots.last_event_at <= EXCLUDED.last_event_at
          THEN EXCLUDED.status ELSE ticket_snapshots.status END,
        resolved_at = CASE
          WHEN ticket_snapshots.last_event_at <= EXCLUDED.last_event_at
          THEN EXCLUDED.resolved_at ELSE ticket_snapshots.resolved_at END,
        organization_id = CASE
          WHEN ticket_snapshots.last_event_at <= EXCLUDED.last_event_at
          THEN EXCLUDED.organization_id ELSE ticket_snapshots.organization_id END,
        last_event_at = GREATEST(ticket_snapshots.last_event_at, EXCLUDED.last_event_at)
    `;
  }

  async total(organizationId: string): Promise<number> {
    return this.prisma.ticketSnapshot.count({ where: { organizationId } });
  }

  async countByStatus(organizationId: string): Promise<Record<string, number>> {
    const groups = await this.prisma.ticketSnapshot.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    });
    return Object.fromEntries(
      groups.map((group) => [group.status, group._count._all]),
    );
  }

  async countByPriority(
    organizationId: string,
  ): Promise<Record<string, number>> {
    const groups = await this.prisma.ticketSnapshot.groupBy({
      by: ['priority'],
      where: { organizationId, priority: { not: null } },
      _count: { _all: true },
    });
    return Object.fromEntries(
      groups.map((group) => [group.priority as string, group._count._all]),
    );
  }

  async createdPerDaySince(
    organizationId: string,
    from: Date,
  ): Promise<DailyCount[]> {
    const rows = await this.prisma.ticketSnapshot.findMany({
      where: { organizationId, createdAt: { gte: from } },
      select: { createdAt: true },
    });
    const buckets = new Map<string, number>();
    for (const row of rows) {
      const day = (row.createdAt as Date).toISOString().slice(0, 10);
      buckets.set(day, (buckets.get(day) ?? 0) + 1);
    }
    return [...buckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day, count }));
  }
}

export class PrismaUserSnapshotRepository implements UserSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  async applyRegistered(input: {
    userId: string;
    registeredAt: Date;
  }): Promise<void> {
    // skipDuplicates compiles to ON CONFLICT DO NOTHING on the primary key —
    // which also means it can never clobber an organization a membership
    // event already stamped (see applyMembershipCreated).
    await this.prisma.userSnapshot.createMany({
      data: [{ userId: input.userId, registeredAt: input.registeredAt }],
      skipDuplicates: true,
    });
  }

  async applyMembershipCreated(input: ApplyMembershipCreated): Promise<void> {
    // upsert keyed on the primary key compiles to a single INSERT .. ON
    // CONFLICT DO UPDATE. The create path exists for a lost or late
    // registration event: registeredAt is then the membership time, the
    // honest nearby value (see the port contract).
    await this.prisma.userSnapshot.upsert({
      where: { userId: input.userId },
      create: {
        userId: input.userId,
        registeredAt: input.createdAt,
        organizationId: input.organizationId,
      },
      update: { organizationId: input.organizationId },
    });
  }

  async total(organizationId: string): Promise<number> {
    return this.prisma.userSnapshot.count({ where: { organizationId } });
  }
}
