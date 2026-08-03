import {
  InMemoryBranchRefRepository,
  InMemoryStationRefRepository,
  InMemoryTeamRefRepository,
} from '../testing/fakes';
import {
  aBranchRef,
  OTHER_BRANCH,
  OTHER_ORGANIZATION,
  TEST_BRANCH,
  TEST_ORGANIZATION,
  TEST_STATION,
} from '../../testing/fixtures';
import type {
  BranchSnapshot,
  SnapshotPage,
  StationSnapshot,
  StructureSnapshotSource,
  TeamSnapshot,
} from '../ports/structure-snapshot.source';
import { ReconcileStructureUseCase } from './reconcile-structure';

const TEAM = '00000000-0000-4000-8000-0000000000c1';
const OTHER_TEAM = '00000000-0000-4000-8000-0000000000c2';
const OLD = new Date('2026-08-01T00:00:00.000Z');
const NEW = new Date('2026-08-02T00:00:00.000Z');

/**
 * A snapshot source that pages, can be made to fail, and records how it was
 * asked — the three things the walk's behaviour depends on.
 */
class FakeSnapshotSource implements StructureSnapshotSource {
  branchPages: BranchSnapshot[][] = [[]];
  stationPages: StationSnapshot[][] = [[]];
  teamPages: TeamSnapshot[][] = [[]];
  failBranchesFromPage: number | null = null;
  readonly branchCursors: (string | null)[] = [];

  async branches(after: string | null): Promise<SnapshotPage<BranchSnapshot>> {
    this.branchCursors.push(after);
    const index = pageIndex(after, this.branchPages, (row) => row.branchId);
    if (
      this.failBranchesFromPage !== null &&
      index >= this.failBranchesFromPage
    ) {
      throw new Error('snapshot unavailable');
    }
    return page(this.branchPages, index, (row) => row.branchId);
  }

  async stations(after: string | null): Promise<SnapshotPage<StationSnapshot>> {
    const index = pageIndex(after, this.stationPages, (row) => row.stationId);
    return page(this.stationPages, index, (row) => row.stationId);
  }

  async teams(after: string | null): Promise<SnapshotPage<TeamSnapshot>> {
    const index = pageIndex(after, this.teamPages, (row) => row.teamId);
    return page(this.teamPages, index, (row) => row.teamId);
  }
}

function pageIndex<T>(
  after: string | null,
  pages: T[][],
  idOf: (row: T) => string,
): number {
  if (after === null) {
    return 0;
  }
  const found = pages.findIndex(
    (rows) => rows.length > 0 && idOf(rows[rows.length - 1]) === after,
  );
  return found < 0 ? pages.length : found + 1;
}

function page<T>(
  pages: T[][],
  index: number,
  idOf: (row: T) => string,
): SnapshotPage<T> {
  const items = pages[index] ?? [];
  const hasMore = index + 1 < pages.length;
  return {
    items,
    nextCursor:
      hasMore && items.length > 0 ? idOf(items[items.length - 1]) : null,
  };
}

function branchSnapshot(
  overrides: Partial<BranchSnapshot> = {},
): BranchSnapshot {
  return {
    branchId: TEST_BRANCH,
    organizationId: TEST_ORGANIZATION,
    code: 'BR-12',
    name: 'Store 12',
    status: 'active',
    updatedAt: NEW,
    ...overrides,
  };
}

function teamSnapshot(overrides: Partial<TeamSnapshot> = {}): TeamSnapshot {
  return {
    teamId: TEAM,
    organizationId: TEST_ORGANIZATION,
    name: 'IT support',
    status: 'active',
    branchIds: [],
    updatedAt: NEW,
    ...overrides,
  };
}

function buildContext() {
  const source = new FakeSnapshotSource();
  const branches = new InMemoryBranchRefRepository();
  const stations = new InMemoryStationRefRepository();
  const teams = new InMemoryTeamRefRepository();
  return {
    source,
    branches,
    stations,
    teams,
    useCase: new ReconcileStructureUseCase(source, branches, stations, teams),
  };
}

describe('ReconcileStructureUseCase — bootstrap from empty (scenarios 1–4)', () => {
  it('reconstructs branches, stations and teams into an empty projection', async () => {
    const ctx = buildContext();
    ctx.source.branchPages = [[branchSnapshot()]];
    ctx.source.stationPages = [
      [
        {
          stationId: TEST_STATION,
          branchId: TEST_BRANCH,
          organizationId: TEST_ORGANIZATION,
          code: 'CASH-2',
          name: 'Cashier 2',
          area: 'checkout',
          status: 'active',
          updatedAt: NEW,
        },
      ],
    ];
    ctx.source.teamPages = [[teamSnapshot()]];

    const result = await ctx.useCase.execute();

    expect(result.branches).toEqual(
      expect.objectContaining({ scanned: 1, inserted: 1, updated: 0 }),
    );
    expect(result.complete).toBe(true);
    // The rows a cold service was missing, now present and usable.
    expect(
      await ctx.branches.findActive(TEST_ORGANIZATION, TEST_BRANCH),
    ).not.toBeNull();
    expect(
      await ctx.stations.findActive(
        TEST_ORGANIZATION,
        TEST_BRANCH,
        TEST_STATION,
      ),
    ).not.toBeNull();
    expect(await ctx.teams.findActive(TEST_ORGANIZATION, TEAM)).not.toBeNull();
  });

  it('keeps an organization-wide team organization-wide (scenario 6)', async () => {
    const ctx = buildContext();
    ctx.source.teamPages = [[teamSnapshot({ branchIds: [] })]];

    await ctx.useCase.execute();

    const team = await ctx.teams.findActive(TEST_ORGANIZATION, TEAM);
    // Empty is the organization-wide case and must survive the rebuild as
    // emptiness, not as "no scope was applied" (ADR 0022).
    expect(team?.branchIds).toEqual([]);
  });

  it('restores a branch-scoped team with its exact scope (scenario 7)', async () => {
    const ctx = buildContext();
    ctx.source.teamPages = [
      [teamSnapshot({ branchIds: [TEST_BRANCH, OTHER_BRANCH] })],
    ];

    await ctx.useCase.execute();

    const team = await ctx.teams.findActive(TEST_ORGANIZATION, TEAM);
    expect([...(team?.branchIds ?? [])].sort()).toEqual(
      [TEST_BRANCH, OTHER_BRANCH].sort(),
    );
  });
});

describe('ReconcileStructureUseCase — reconciling a partial projection', () => {
  it('inserts what is missing and updates what is stale (scenarios 3, 4, 11)', async () => {
    const ctx = buildContext();
    // Present but stale: the branch was archived while this service was down.
    ctx.branches.seed(aBranchRef({ status: 'active', updatedAt: OLD }));
    ctx.source.branchPages = [
      [
        branchSnapshot({ status: 'archived', updatedAt: NEW }),
        branchSnapshot({
          branchId: OTHER_BRANCH,
          code: 'BR-9',
          name: 'Store 9',
          updatedAt: NEW,
        }),
      ],
    ];

    const result = await ctx.useCase.execute();

    expect(result.branches).toEqual(
      expect.objectContaining({
        scanned: 2,
        inserted: 1,
        updated: 1,
        unchanged: 0,
        archived: 1,
      }),
    );
    // The stale archived state is corrected: an archived branch is no longer
    // findable as active, which is what ticket creation checks.
    expect(
      await ctx.branches.findActive(TEST_ORGANIZATION, TEST_BRANCH),
    ).toBeNull();
  });

  it('counts an already-current row as unchanged and writes nothing new', async () => {
    const ctx = buildContext();
    ctx.branches.seed(aBranchRef({ updatedAt: NEW }));
    ctx.source.branchPages = [[branchSnapshot({ updatedAt: NEW })]];

    const result = await ctx.useCase.execute();

    expect(result.branches).toEqual(
      expect.objectContaining({
        scanned: 1,
        inserted: 0,
        updated: 0,
        unchanged: 1,
      }),
    );
  });

  it('never lets an older snapshot overwrite a newer row (scenario 12)', async () => {
    const ctx = buildContext();
    // An event applied a newer name while the walk was in flight.
    ctx.branches.seed(aBranchRef({ name: 'Renamed by event', updatedAt: NEW }));
    ctx.source.branchPages = [
      [branchSnapshot({ name: 'Older snapshot name', updatedAt: OLD })],
    ];

    await ctx.useCase.execute();

    // The last-write-wins guard is what makes subscribe-then-snapshot safe:
    // the snapshot cannot undo an update that arrived during the run.
    const branch = await ctx.branches.findActive(
      TEST_ORGANIZATION,
      TEST_BRANCH,
    );
    expect(branch?.name).toBe('Renamed by event');
  });
});

describe('ReconcileStructureUseCase — idempotence and resumption', () => {
  it('produces no change on a second run (scenario 8)', async () => {
    const ctx = buildContext();
    ctx.source.branchPages = [[branchSnapshot()]];
    ctx.source.teamPages = [[teamSnapshot({ branchIds: [TEST_BRANCH] })]];

    const first = await ctx.useCase.execute();
    const second = await ctx.useCase.execute();

    expect(first.branches.inserted).toBe(1);
    expect(second.branches).toEqual(
      expect.objectContaining({ inserted: 0, updated: 0, unchanged: 1 }),
    );
    // And the semantics did not drift: the scope is still exactly one branch.
    const team = await ctx.teams.findActive(TEST_ORGANIZATION, TEAM);
    expect(team?.branchIds).toEqual([TEST_BRANCH]);
  });

  it('pages through more rows than one page holds (scenario 8)', async () => {
    const ctx = buildContext();
    ctx.source.branchPages = [
      [branchSnapshot({ branchId: TEST_BRANCH })],
      [branchSnapshot({ branchId: OTHER_BRANCH, code: 'BR-9' })],
    ];

    const result = await ctx.useCase.execute();

    expect(result.branches.scanned).toBe(2);
    // The second page was asked for with the first page's last id — keyset,
    // not offset, so a row inserted mid-run cannot make the walk skip one.
    expect(ctx.source.branchCursors).toEqual([null, TEST_BRANCH]);
  });

  it('stops a projection at a failed page instead of reporting completion (scenario 9)', async () => {
    const ctx = buildContext();
    ctx.source.branchPages = [
      [branchSnapshot({ branchId: TEST_BRANCH })],
      [branchSnapshot({ branchId: OTHER_BRANCH, code: 'BR-9' })],
    ];
    ctx.source.failBranchesFromPage = 1;
    ctx.source.teamPages = [[teamSnapshot()]];

    const result = await ctx.useCase.execute();

    expect(result.branches.failed).toBe(1);
    expect(result.complete).toBe(false);
    // The first page's work is kept — re-running is the recovery, and it is
    // safe precisely because every write is idempotent.
    expect(
      await ctx.branches.findActive(TEST_ORGANIZATION, TEST_BRANCH),
    ).not.toBeNull();
    // One unreachable projection does not hide the state of the others.
    expect(result.teams.inserted).toBe(1);
  });

  it('resumes from a cursor without treating earlier rows as orphans', async () => {
    const ctx = buildContext();
    // A row from a page the resumed walk will never read.
    ctx.branches.seed(aBranchRef({ id: TEST_BRANCH }));
    ctx.source.branchPages = [
      [branchSnapshot({ branchId: OTHER_BRANCH, code: 'BR-9' })],
    ];

    const result = await ctx.useCase.execute({
      after: { branches: TEST_BRANCH },
    });

    // A resumed walk has not seen the earlier pages, so every row before the
    // cursor would look orphaned. It declines to guess.
    expect(result.branches.orphaned).toBe(0);
  });
});

describe('ReconcileStructureUseCase — drift is reported, never repaired', () => {
  it('counts a local row the source did not offer, and keeps it (D6)', async () => {
    const ctx = buildContext();
    ctx.branches.seed(aBranchRef({ id: OTHER_BRANCH }));
    ctx.source.branchPages = [[branchSnapshot({ branchId: TEST_BRANCH })]];

    const result = await ctx.useCase.execute();

    expect(result.branches.orphaned).toBe(1);
    // The domain archives rather than deletes, so a row with no source row is
    // a fact nothing explains — removing it would repair an ambiguous record.
    expect(ctx.branches.rows.has(OTHER_BRANCH)).toBe(true);
  });
});

describe('ReconcileStructureUseCase — the dry run (scenario 13)', () => {
  it('reports what would change and writes nothing', async () => {
    const ctx = buildContext();
    ctx.branches.seed(aBranchRef({ name: 'Old name', updatedAt: OLD }));
    ctx.source.branchPages = [
      [
        branchSnapshot({ name: 'New name', updatedAt: NEW }),
        branchSnapshot({ branchId: OTHER_BRANCH, code: 'BR-9' }),
      ],
    ];

    const result = await ctx.useCase.execute({ dryRun: true });

    expect(result.dryRun).toBe(true);
    // The same numbers a real run would report — that is what makes it an
    // integrity check rather than a different code path.
    expect(result.branches).toEqual(
      expect.objectContaining({ scanned: 2, inserted: 1, updated: 1 }),
    );
    const untouched = await ctx.branches.findActive(
      TEST_ORGANIZATION,
      TEST_BRANCH,
    );
    expect(untouched?.name).toBe('Old name');
    expect(ctx.branches.rows.has(OTHER_BRANCH)).toBe(false);
  });
});

describe('ReconcileStructureUseCase — tenants stay apart (scenario 10)', () => {
  it('writes each row under the organization the snapshot states', async () => {
    const ctx = buildContext();
    ctx.source.branchPages = [
      [
        branchSnapshot({
          branchId: TEST_BRANCH,
          organizationId: TEST_ORGANIZATION,
        }),
        branchSnapshot({
          branchId: OTHER_BRANCH,
          organizationId: OTHER_ORGANIZATION,
          code: 'RIVAL-1',
          // The same NAME in the other tenant: only the stated organization
          // can tell them apart.
          name: 'Store 12',
        }),
      ],
    ];
    ctx.source.teamPages = [
      [
        teamSnapshot({ teamId: TEAM, organizationId: TEST_ORGANIZATION }),
        teamSnapshot({
          teamId: OTHER_TEAM,
          organizationId: OTHER_ORGANIZATION,
        }),
      ],
    ];

    await ctx.useCase.execute();

    // Organization A cannot see B's rows and vice versa, even though the
    // snapshot that produced them was a single global read.
    expect(
      await ctx.branches.findActive(TEST_ORGANIZATION, OTHER_BRANCH),
    ).toBeNull();
    expect(
      await ctx.branches.findActive(OTHER_ORGANIZATION, TEST_BRANCH),
    ).toBeNull();
    expect(
      await ctx.teams.findActive(TEST_ORGANIZATION, OTHER_TEAM),
    ).toBeNull();
    expect(
      await ctx.teams.findActive(OTHER_ORGANIZATION, OTHER_TEAM),
    ).not.toBeNull();
  });
});
