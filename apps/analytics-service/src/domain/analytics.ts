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
 * One row per registered account. Kept minimal on purpose: the dashboard
 * only ever counts these, so the projection stores exactly what the scoped
 * count needs.
 */
export interface UserSnapshot {
  readonly userId: string;
  readonly registeredAt: Date;
  /**
   * Null between registering and the membership event arriving — registration
   * is anonymous by design, so the tenant is stamped by membership.created.
   * A null row falls out of every scoped count until then. Deliberately
   * EXEMPT from the phase-7 NOT NULL: the registration-first write path must
   * stay able to insert a tenantless row.
   */
  readonly organizationId: string | null;
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
