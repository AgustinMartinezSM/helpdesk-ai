import type { MessagingLogger } from '@helpdesk-ai/messaging';
import type {
  BranchRefRepository,
  StationRefRepository,
  TeamRefRepository,
} from '../ports/structure-refs.repository';
import type {
  BranchSnapshot,
  SnapshotPage,
  StationSnapshot,
  StructureSnapshotSource,
  TeamSnapshot,
} from '../ports/structure-snapshot.source';

/**
 * What one projection's reconciliation did. Counts only — no name, no code,
 * no ticket, and no organization beyond the ids the platform already logs.
 */
export interface ProjectionOutcome {
  scanned: number;
  inserted: number;
  updated: number;
  unchanged: number;
  /** Rows whose status arrived as archived; a subset of inserted+updated. */
  archived: number;
  /**
   * Local rows the source did not offer. COUNTED, NEVER DELETED — see the
   * class comment.
   */
  orphaned: number;
  failed: number;
}

export interface ReconcileStructureResult {
  dryRun: boolean;
  branches: ProjectionOutcome;
  stations: ProjectionOutcome;
  teams: ProjectionOutcome;
  /** True when every projection completed without a failed page. */
  complete: boolean;
}

export interface ReconcileStructureInput {
  /** Reads everything, writes nothing. The integrity check. */
  dryRun?: boolean;
  /**
   * Continue rather than restart. A convenience for an operator resuming a
   * long run — NOT the correctness mechanism, which is that re-running from
   * the beginning is always safe.
   */
  after?: { branches?: string; stations?: string; teams?: string };
}

function emptyOutcome(): ProjectionOutcome {
  return {
    scanned: 0,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    archived: 0,
    orphaned: 0,
    failed: 0,
  };
}

/**
 * Rebuilds this service's structure projections from the service that owns
 * them (Sprint 9.16).
 *
 * ## Why it exists
 *
 * A durable queue does not exist before its consumer's first boot, and a topic
 * exchange discards a message with no bound queue. So this service, started
 * after organizations-service has been working, has an empty projection and
 * fills only from the NEXT event — while `CreateTicketUseCase` refuses every
 * ticket naming a branch it cannot see. Editing each branch upstream to make
 * it re-emit is a person doing by hand what nothing does automatically.
 *
 * ## The ordering rule, which is the whole safety argument
 *
 * **Subscribe first, reconcile second.** `MessagingClient.subscribe()` resolves
 * only after the queue is declared and bound, so once the consumer has started
 * nothing published afterwards can be discarded — it waits in the queue. The
 * snapshot is then applied through the SAME last-write-wins path the events
 * use (`stored.updated_at <= incoming` decides), so:
 *
 * - an update published before the snapshot read is already in the snapshot;
 * - one published after is queued, applied later, and wins on its newer
 *   timestamp;
 * - one published during is in the snapshot or the queue or both, and LWW
 *   settles it either way.
 *
 * No update can be lost, and it takes no cursor table, no pause and no lock.
 * Reversing the order — snapshot first, subscribe second — would open exactly
 * the window this exists to close.
 *
 * ## Why nothing is ever deleted here
 *
 * The domain does not delete: branches and support teams are ARCHIVED, and
 * archiving does not cascade (Sprint 9.11, D4). So a local row the source did
 * not offer is not "a deletion to mirror" — it is a fact nothing explains, and
 * removing it would be repairing an ambiguous record. It is counted as
 * `orphaned` and logged; acting on it stays a human decision.
 */
export class ReconcileStructureUseCase {
  constructor(
    private readonly source: StructureSnapshotSource,
    private readonly branches: BranchRefRepository,
    private readonly stations: StationRefRepository,
    private readonly teams: TeamRefRepository,
    private readonly logger?: MessagingLogger,
  ) {}

  async execute(
    input: ReconcileStructureInput = {},
  ): Promise<ReconcileStructureResult> {
    const dryRun = input.dryRun ?? false;

    const branches = await this.reconcileBranches(
      dryRun,
      input.after?.branches ?? null,
    );
    const stations = await this.reconcileStations(
      dryRun,
      input.after?.stations ?? null,
    );
    const teams = await this.reconcileTeams(dryRun, input.after?.teams ?? null);

    const result: ReconcileStructureResult = {
      dryRun,
      branches,
      stations,
      teams,
      complete:
        branches.failed === 0 && stations.failed === 0 && teams.failed === 0,
    };

    // Counts and a mode. Nothing here names a branch, a person or a ticket:
    // a projection-health line has to be safe to read in an aggregated log.
    this.logger?.log(
      `structure reconciliation ${dryRun ? '(dry run) ' : ''}` +
        `branches ${summarize(branches)}; ` +
        `stations ${summarize(stations)}; ` +
        `teams ${summarize(teams)}`,
    );
    if (!result.complete) {
      this.logger?.error(
        'structure reconciliation finished with failed pages; the projection may still be incomplete',
      );
    }
    return result;
  }

  private async reconcileBranches(
    dryRun: boolean,
    from: string | null,
  ): Promise<ProjectionOutcome> {
    return this.walk(
      from,
      (after) => this.source.branches(after),
      (row) => row.branchId,
      async (row: BranchSnapshot, outcome) => {
        const existing = await this.branches.findAny(row.branchId);
        classify(existing, row.updatedAt, row.status, outcome);
        if (!dryRun) {
          await this.branches.apply({
            branchId: row.branchId,
            organizationId: row.organizationId,
            code: row.code,
            name: row.name,
            status: row.status,
            occurredAt: row.updatedAt,
          });
        }
      },
      async (seen) => this.branches.idsNotIn(seen),
    );
  }

  private async reconcileStations(
    dryRun: boolean,
    from: string | null,
  ): Promise<ProjectionOutcome> {
    return this.walk(
      from,
      (after) => this.source.stations(after),
      (row) => row.stationId,
      async (row: StationSnapshot, outcome) => {
        const existing = await this.stations.findAny(row.stationId);
        classify(existing, row.updatedAt, row.status, outcome);
        if (!dryRun) {
          await this.stations.apply({
            stationId: row.stationId,
            branchId: row.branchId,
            organizationId: row.organizationId,
            code: row.code,
            name: row.name,
            area: row.area,
            status: row.status,
            occurredAt: row.updatedAt,
          });
        }
      },
      async (seen) => this.stations.idsNotIn(seen),
    );
  }

  private async reconcileTeams(
    dryRun: boolean,
    from: string | null,
  ): Promise<ProjectionOutcome> {
    return this.walk(
      from,
      (after) => this.source.teams(after),
      (row) => row.teamId,
      async (row: TeamSnapshot, outcome) => {
        const existing = await this.teams.findAny(row.teamId);
        classify(existing, row.updatedAt, row.status, outcome);
        if (!dryRun) {
          await this.teams.apply({
            teamId: row.teamId,
            organizationId: row.organizationId,
            name: row.name,
            status: row.status,
            occurredAt: row.updatedAt,
          });
          // The scope travels with the team and is applied as a whole set —
          // an empty array is the organization-wide case, not "no change".
          await this.teams.applyScope({
            teamId: row.teamId,
            organizationId: row.organizationId,
            branchIds: [...row.branchIds],
            occurredAt: row.updatedAt,
          });
        }
      },
      async (seen) => this.teams.idsNotIn(seen),
    );
  }

  /**
   * One projection, page by page.
   *
   * A page that throws is counted as failed and ENDS that projection's walk:
   * continuing past it would advance the cursor over rows nobody read, and
   * report a completed reconciliation that had a hole in it. The other
   * projections still run — one unreachable page should not hide the state of
   * the rest.
   */
  private async walk<T>(
    from: string | null,
    fetchPage: (after: string | null) => Promise<SnapshotPage<T>>,
    idOf: (row: T) => string,
    applyRow: (row: T, outcome: ProjectionOutcome) => Promise<void>,
    orphansOf: (seen: string[]) => Promise<string[]>,
  ): Promise<ProjectionOutcome> {
    const outcome = emptyOutcome();
    const seen: string[] = [];
    let after = from;
    let exhausted = false;

    while (!exhausted) {
      let page: SnapshotPage<T>;
      try {
        page = await fetchPage(after);
      } catch (error) {
        outcome.failed += 1;
        this.logger?.error(
          `structure reconciliation page failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return outcome;
      }

      for (const row of page.items) {
        outcome.scanned += 1;
        seen.push(idOf(row));
        try {
          await applyRow(row, outcome);
        } catch (error) {
          outcome.failed += 1;
          this.logger?.error(
            `structure reconciliation row failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }

      after = page.nextCursor;
      exhausted = after === null;
    }

    // Only meaningful for a walk that reached the end AND started at the
    // beginning: a resumed run has not seen the earlier pages, so every row
    // before its cursor would look orphaned.
    if (from === null && outcome.failed === 0) {
      outcome.orphaned = (await orphansOf(seen)).length;
    }
    return outcome;
  }
}

/**
 * Decides what this row WOULD do, before it is applied — which is what makes
 * the dry run report the same numbers a real run would.
 */
function classify(
  existing: { updatedAt: Date } | null,
  incoming: Date,
  status: string,
  outcome: ProjectionOutcome,
): void {
  if (status === 'archived') {
    outcome.archived += 1;
  }
  if (!existing) {
    outcome.inserted += 1;
    return;
  }
  // The projection's own rule: an incoming write with an older timestamp is
  // ignored, and an equal one changes nothing observable.
  if (existing.updatedAt.getTime() < incoming.getTime()) {
    outcome.updated += 1;
    return;
  }
  outcome.unchanged += 1;
}

function summarize(outcome: ProjectionOutcome): string {
  return (
    `scanned=${outcome.scanned} inserted=${outcome.inserted} ` +
    `updated=${outcome.updated} unchanged=${outcome.unchanged} ` +
    `archived=${outcome.archived} orphaned=${outcome.orphaned} ` +
    `failed=${outcome.failed}`
  );
}
