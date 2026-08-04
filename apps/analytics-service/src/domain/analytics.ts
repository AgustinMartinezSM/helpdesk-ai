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
  /**
   * Tenant this snapshot belongs to (ADR 0012). Required since the phase-7
   * NOT NULL on the column: every v2 event carries one, and may still
   * correct the stored value under the same LWW guard as status.
   */
  readonly organizationId: string;
}

/**
 * One row per MEMBERSHIP EDGE — not per account (Sprint 10.7, ADR 0026).
 *
 * Kept minimal on purpose: the dashboard only ever counts these, so the
 * projection stores exactly what the scoped count needs. What it does NOT
 * store any more is a registration: a row with no organization answers
 * nothing this projection is asked, and keeping one was what let the holding
 * pen claim every person.
 */
export interface UserSnapshot {
  readonly userId: string;
  /** Never null. The tenant is what this row exists to record. */
  readonly organizationId: string;
  /** When they joined THIS organization — the membership's creation time. */
  readonly joinedAt: Date;
}

export interface DailyCount {
  /** UTC calendar day, YYYY-MM-DD. */
  readonly day: string;
  readonly count: number;
}

/** Every figure below is scoped to one organization — never the whole desk. */
export interface AnalyticsSummary {
  readonly totalTickets: number;
  readonly byStatus: Record<string, number>;
  /** Excludes snapshots whose priority is still unknown. */
  readonly byPriority: Record<string, number>;
  /** Seven consecutive UTC days ending today; zero-filled. */
  readonly createdLast7Days: DailyCount[];
  readonly totalUsers: number;
}
