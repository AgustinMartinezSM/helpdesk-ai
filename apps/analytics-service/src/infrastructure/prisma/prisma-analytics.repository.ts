import {
  COUNTED_MEMBERSHIP_STATUS,
  type DailyCount,
} from '../../domain/analytics';
import type {
  ApplyMembershipCreated,
  ApplyMembershipStatusChanged,
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

  /**
   * ONE statement, with the last-writer-wins guard evaluated INSIDE Postgres
   * — the same shape the ticket snapshots have used since Sprint 7, and for
   * the same reason: two events for one edge applied concurrently must not
   * both read a stale watermark, and the row lock on DO UPDATE serializes
   * them. Ties resolve to the later arrival, which on a prefetch=1 queue is
   * publication order.
   *
   * What this replaced is worth remembering rather than deleting silently.
   * Until Sprint 10.7 the row was keyed on userId alone and the tenant was
   * stamped only `WHERE organization_id IS NULL`, so the first membership won
   * — and the first membership every account gets is the BOOTSTRAP one,
   * created while consuming the very registration event that seeded the row.
   * Every real organization counted approximately nobody, for four sprints.
   * 10.7 fixed that with `ON CONFLICT DO NOTHING`, which was right while the
   * only non-key column was a timestamp nothing read; a status has to be
   * updated, so the guard came with it.
   */
  async applyMembershipCreated(input: ApplyMembershipCreated): Promise<void> {
    /**
     * `joined_at` takes LEAST, not the incoming value and not a plain keep.
     *
     * A membership's creation time is by construction the EARLIEST fact about
     * an edge, so LEAST converges on the truth without the row having to
     * remember whether it was a placeholder written by a status change — which
     * is the one case where the stored value is a guess. It cannot move the
     * column forward, so the property that mattered before still holds.
     *
     * The status guard is what stops ordinary out-of-order delivery from
     * reviving somebody suspended after they joined: a created event is older
     * than any change to that membership, so it loses.
     */
    await this.prisma.$executeRaw`
      INSERT INTO user_snapshots
        (user_id, organization_id, joined_at, status, last_event_at)
      VALUES
        (${input.userId}::uuid, ${input.organizationId}::uuid,
         ${input.createdAt}, ${input.status}, ${input.createdAt})
      ON CONFLICT (user_id, organization_id) DO UPDATE SET
        joined_at = LEAST(user_snapshots.joined_at, EXCLUDED.joined_at),
        status = CASE
          WHEN user_snapshots.last_event_at <= EXCLUDED.last_event_at
          THEN EXCLUDED.status ELSE user_snapshots.status END,
        last_event_at = GREATEST(
          user_snapshots.last_event_at, EXCLUDED.last_event_at)
    `;
  }

  /**
   * The write that makes the headcount go down (Sprint 10.8).
   *
   * An unseen edge INSERTS rather than skipping: a lost created event must not
   * make a live person invisible, and this projection stores no role template,
   * so the placeholder invents nothing — it records the status the event
   * carries and takes the change's own timestamp as `joined_at`, which a later
   * created event corrects downward through LEAST above.
   *
   * It never deletes, including on `deactivated`. That status stopped being
   * terminal in Sprint 9.10, and a delete would also throw away the watermark
   * that makes a replayed suspension harmless.
   */
  async applyMembershipStatusChanged(
    input: ApplyMembershipStatusChanged,
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO user_snapshots
        (user_id, organization_id, joined_at, status, last_event_at)
      VALUES
        (${input.userId}::uuid, ${input.organizationId}::uuid,
         ${input.changedAt}, ${input.status}, ${input.changedAt})
      ON CONFLICT (user_id, organization_id) DO UPDATE SET
        status = CASE
          WHEN user_snapshots.last_event_at <= EXCLUDED.last_event_at
          THEN EXCLUDED.status ELSE user_snapshots.status END,
        last_event_at = GREATEST(
          user_snapshots.last_event_at, EXCLUDED.last_event_at)
    `;
  }

  /**
   * Active members, never every edge ever recorded. The status this asks for
   * is shared with the in-memory double rather than spelled twice.
   */
  async total(organizationId: string): Promise<number> {
    return this.prisma.userSnapshot.count({
      where: { organizationId, status: COUNTED_MEMBERSHIP_STATUS },
    });
  }
}
