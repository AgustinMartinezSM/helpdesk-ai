import { isStaff, type Actor } from '@helpdesk-ai/security';
import { ForbiddenAnalyticsActionError } from '../../domain/errors';
import type { AnalyticsSummary, DailyCount } from '../../domain/analytics';
import type {
  Clock,
  TicketSnapshotRepository,
  UserSnapshotRepository,
} from '../ports/analytics.repository';

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Staff-only: the dashboard aggregates the whole desk, not one user. */
export class GetAnalyticsSummaryUseCase {
  constructor(
    private readonly tickets: TicketSnapshotRepository,
    private readonly users: UserSnapshotRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor): Promise<AnalyticsSummary> {
    if (!isStaff(actor)) {
      throw new ForbiddenAnalyticsActionError();
    }

    const now = this.clock.now();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const from = new Date(startOfToday.getTime() - 6 * DAY_MS);

    const [totalTickets, byStatus, byPriority, perDay, totalUsers] =
      await Promise.all([
        this.tickets.total(),
        this.tickets.countByStatus(),
        this.tickets.countByPriority(),
        this.tickets.createdPerDaySince(from),
        this.users.total(),
      ]);

    // Zero-fill the window so the dashboard always gets seven points.
    const counted = new Map(perDay.map((entry) => [entry.day, entry.count]));
    const createdLast7Days: DailyCount[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const day = utcDayOf(new Date(from.getTime() + offset * DAY_MS));
      createdLast7Days.push({ day, count: counted.get(day) ?? 0 });
    }

    return { totalTickets, byStatus, byPriority, createdLast7Days, totalUsers };
  }
}
