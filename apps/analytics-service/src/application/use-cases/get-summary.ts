import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
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

/**
 * analytics.read gates the dashboard: it aggregates a whole organization,
 * not one user. Per the approved matrix
 * (docs/architecture/tenancy-target-state.md) that key belongs to admins,
 * owners and auditors — agents, who used to see this as generic staff,
 * deliberately lose it. The organization comes from the token, never from
 * the request: all five aggregates take it as a required scope in one
 * coherent step, because a dashboard mixing scoped and unscoped numbers
 * would be worse than either.
 */
export class GetAnalyticsSummaryUseCase {
  constructor(
    private readonly tickets: TicketSnapshotRepository,
    private readonly users: UserSnapshotRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor): Promise<AnalyticsSummary> {
    if (!hasPermission(actor, PERMISSIONS.ANALYTICS_READ)) {
      throw new ForbiddenAnalyticsActionError();
    }
    const organizationId = requireOrganization(actor);

    const now = this.clock.now();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const from = new Date(startOfToday.getTime() - 6 * DAY_MS);

    const [totalTickets, byStatus, byPriority, perDay, totalUsers] =
      await Promise.all([
        this.tickets.total(organizationId),
        this.tickets.countByStatus(organizationId),
        this.tickets.countByPriority(organizationId),
        this.tickets.createdPerDaySince(organizationId, from),
        this.users.total(organizationId),
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
