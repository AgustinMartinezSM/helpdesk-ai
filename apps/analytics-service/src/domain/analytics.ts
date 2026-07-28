/**
 * One row per ticket, projected from lifecycle events. A snapshot instead
 * of incremental counters: at-least-once delivery double-counts counters,
 * while a keyed snapshot guarded by lastEventAt is naturally idempotent.
 */
export interface TicketSnapshot {
  readonly ticketId: string;
  readonly status: string;
  /** Null until the ticket's created event arrives (out-of-order tolerance). */
  readonly priority: string | null;
  readonly createdAt: Date | null;
  /** Set while the ticket sits in 'resolved'; cleared on any other status. */
  readonly resolvedAt: Date | null;
  /** Envelope occurredAt of the newest applied event — the LWW guard. */
  readonly lastEventAt: Date;
}

export interface DailyCount {
  /** UTC calendar day, YYYY-MM-DD. */
  readonly day: string;
  readonly count: number;
}

export interface AnalyticsSummary {
  readonly totalTickets: number;
  readonly byStatus: Record<string, number>;
  /** Excludes snapshots whose priority is still unknown. */
  readonly byPriority: Record<string, number>;
  /** Seven consecutive UTC days ending today; zero-filled. */
  readonly createdLast7Days: DailyCount[];
  readonly totalUsers: number;
}
