import { randomUUID } from 'node:crypto';
import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  BranchNotFoundError,
  ForbiddenTicketActionError,
  InvalidBranchError,
  InvalidStationError,
} from '../../domain/errors';
import { canView } from '../../domain/ticket';
import {
  aBranchRef,
  aStationRef,
  aTicket,
  FOREIGN_BRANCH,
  idsOf,
  OTHER_BRANCH,
  OTHER_ORGANIZATION,
  TEST_BRANCH,
  TEST_ORGANIZATION,
  TEST_STATION,
} from '../../testing/fixtures';
import {
  FakeEventPublisher,
  FixedClock,
  InMemoryBranchRefRepository,
  InMemoryStationRefRepository,
  InMemoryTicketRepository,
} from '../testing/fakes';
import { CreateTicketUseCase } from './create-ticket';
import {
  ListBranchesForPickerUseCase,
  ListStationsForPickerUseCase,
} from './structure-pickers';
import { GetTicketUseCase, ListTicketsUseCase } from './ticket-queries';

/**
 * The Sprint 9.5 matrix: branch context at creation (D4, fail closed),
 * branch-scoped visibility (D2/D3), and the pickers (D6) — including every
 * adversarial cell the DoR names. Two organizations and three branches
 * throughout, so the assertions prove it is the scope doing the filtering,
 * never a missing permission.
 */

const REQUESTER: Actor = {
  id: '11111111-1111-4111-8111-111111111111',
  organizationId: TEST_ORGANIZATION,
  permissions: new Set([
    PERMISSIONS.TICKETS_CREATE,
    PERMISSIONS.TICKETS_READ_OWN,
  ]),
};
/** Covers TEST_BRANCH and nothing else — the store manager of the scenario. */
const BRANCH_MANAGER: Actor = {
  id: '66666666-6666-4666-8666-666666666666',
  organizationId: TEST_ORGANIZATION,
  permissions: new Set([
    PERMISSIONS.TICKETS_CREATE,
    PERMISSIONS.TICKETS_READ_BRANCH,
  ]),
  branchIds: new Set([TEST_BRANCH]),
};
/** Holds the key but covers no branch: absence denies (D2). */
const EMPTY_SET_MANAGER: Actor = {
  ...BRANCH_MANAGER,
  id: '77777777-7777-4777-8777-777777777777',
  branchIds: new Set<string>(),
};
/** Same, one notch further: an old token with no br claim at all. */
const NO_SET_MANAGER: Actor = {
  ...BRANCH_MANAGER,
  id: '88888888-8888-4888-8888-888888888888',
  branchIds: undefined,
};
const ADMIN: Actor = {
  id: '99999999-9999-4999-8999-999999999999',
  organizationId: TEST_ORGANIZATION,
  permissions: new Set([PERMISSIONS.TICKETS_READ_ALL]),
};

function buildContext() {
  const tickets = new InMemoryTicketRepository();
  const clock = new FixedClock(new Date('2026-07-31T12:00:00.000Z'));
  const events = new FakeEventPublisher();
  const branches = new InMemoryBranchRefRepository();
  const stations = new InMemoryStationRefRepository();
  // The standing structure: two branches in the test organization, one in
  // the other, one station under TEST_BRANCH.
  branches.seed(aBranchRef());
  branches.seed(
    aBranchRef({ id: OTHER_BRANCH, code: 'BR-13', name: 'Store 13' }),
  );
  branches.seed(
    aBranchRef({
      id: FOREIGN_BRANCH,
      organizationId: OTHER_ORGANIZATION,
      code: 'BR-90',
      name: 'Foreign store',
    }),
  );
  stations.seed(aStationRef());
  return {
    tickets,
    clock,
    events,
    branches,
    stations,
    create: new CreateTicketUseCase(tickets, clock, events, branches, stations),
    get: new GetTicketUseCase(tickets),
    list: new ListTicketsUseCase(tickets),
    pickBranches: new ListBranchesForPickerUseCase(branches),
    pickStations: new ListStationsForPickerUseCase(branches, stations),
  };
}

describe('CreateTicketUseCase — branch and station context', () => {
  it('persists branch and station on the ticket, and keeps them out of the event (D5)', async () => {
    const ctx = buildContext();

    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'Card terminal down',
      description: 'Cashier 2 cannot charge',
      branchId: TEST_BRANCH,
      stationId: TEST_STATION,
    });

    expect(ticket.branchId).toBe(TEST_BRANCH);
    expect(ticket.operationalStationId).toBe(TEST_STATION);
    // The published payload does NOT gain the branch: adding fields to a
    // published payload is the mutation ADR 0005 forbids (D5).
    expect(ctx.events.created).toHaveLength(1);
    expect(ctx.events.created[0]).not.toHaveProperty('branchId');
    expect(ctx.events.created[0]).not.toHaveProperty('stationId');
    expect(ctx.events.created[0]).not.toHaveProperty('operationalStationId');
  });

  it('leaves branchless and stationless creation exactly as today', async () => {
    const ctx = buildContext();

    // Omitted entirely, and explicit nulls: both are the eight-person shop.
    const omitted = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });
    const nulled = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
      branchId: null,
      stationId: null,
    });

    for (const ticket of [omitted, nulled]) {
      expect(ticket.branchId).toBeNull();
      expect(ticket.operationalStationId).toBeNull();
    }
    expect(ctx.events.created).toHaveLength(2);
  });

  it('refuses a branch of organization B on a ticket of organization A', async () => {
    const ctx = buildContext();

    // FOREIGN_BRANCH is real and active — in the other tenant. The caller's
    // projection has no active row for it, so it answers like a typo.
    await expect(
      ctx.create.execute(REQUESTER, {
        title: 'T',
        description: 'D',
        branchId: FOREIGN_BRANCH,
      }),
    ).rejects.toBeInstanceOf(InvalidBranchError);
    expect(ctx.tickets.tickets.size).toBe(0);
    expect(ctx.events.created).toEqual([]);
  });

  it('answers a guessed branch id exactly like a foreign one', async () => {
    const ctx = buildContext();

    // Same error, same message: the refusal must not reveal whether the id
    // exists somewhere else.
    for (const branchId of [randomUUID(), FOREIGN_BRANCH]) {
      const attempt = ctx.create.execute(REQUESTER, {
        title: 'T',
        description: 'D',
        branchId,
      });
      await expect(attempt).rejects.toBeInstanceOf(InvalidBranchError);
      await expect(attempt).rejects.toThrow(new InvalidBranchError().message);
    }
  });

  it('refuses an archived branch — fail closed against the projection', async () => {
    const ctx = buildContext();
    ctx.branches.seed(aBranchRef({ status: 'archived' }));

    await expect(
      ctx.create.execute(REQUESTER, {
        title: 'T',
        description: 'D',
        branchId: TEST_BRANCH,
      }),
    ).rejects.toBeInstanceOf(InvalidBranchError);
  });

  it('refuses a station of branch X on a ticket of branch Y', async () => {
    const ctx = buildContext();
    // TEST_STATION belongs to TEST_BRANCH; the ticket names OTHER_BRANCH.
    await expect(
      ctx.create.execute(REQUESTER, {
        title: 'T',
        description: 'D',
        branchId: OTHER_BRANCH,
        stationId: TEST_STATION,
      }),
    ).rejects.toBeInstanceOf(InvalidStationError);
  });

  it('refuses a station without a branch: a station only means something inside one', async () => {
    const ctx = buildContext();

    for (const branchId of [undefined, null]) {
      await expect(
        ctx.create.execute(REQUESTER, {
          title: 'T',
          description: 'D',
          branchId,
          stationId: TEST_STATION,
        }),
      ).rejects.toBeInstanceOf(InvalidStationError);
    }
  });

  it('refuses an archived station under an active branch', async () => {
    const ctx = buildContext();
    ctx.stations.seed(aStationRef({ status: 'archived' }));

    await expect(
      ctx.create.execute(REQUESTER, {
        title: 'T',
        description: 'D',
        branchId: TEST_BRANCH,
        stationId: TEST_STATION,
      }),
    ).rejects.toBeInstanceOf(InvalidStationError);
  });
});

describe('canView — the branch visibility matrix', () => {
  const routed = aTicket({ branchId: TEST_BRANCH });
  const routedElsewhere = aTicket({ branchId: OTHER_BRANCH });
  const unrouted = aTicket();

  it('read_all sees every ticket in the organization, routed or not', () => {
    for (const ticket of [routed, routedElsewhere, unrouted]) {
      expect(canView(ADMIN, ticket)).toBe(true);
    }
  });

  it('read_branch sees its branches, not the neighbor branch', () => {
    expect(canView(BRANCH_MANAGER, routed)).toBe(true);
    expect(canView(BRANCH_MANAGER, routedElsewhere)).toBe(false);
  });

  it('keeps a branchless ticket invisible to the branch manager', () => {
    // Deliberate: unrouted intake belongs to the central view until routing
    // (9.11) exists. A branch manager does not see unrouted tickets.
    expect(canView(BRANCH_MANAGER, unrouted)).toBe(false);
  });

  it('denies on an empty or absent branch set — absence never grants (D2)', () => {
    expect(canView(EMPTY_SET_MANAGER, routed)).toBe(false);
    expect(canView(NO_SET_MANAGER, routed)).toBe(false);
  });

  it('always leaves requesters their own tickets, routed anywhere or nowhere', () => {
    const ownUnrouted = aTicket({ requesterId: BRANCH_MANAGER.id });
    const ownElsewhere = aTicket({
      requesterId: BRANCH_MANAGER.id,
      branchId: OTHER_BRANCH,
    });
    expect(canView(BRANCH_MANAGER, ownUnrouted)).toBe(true);
    expect(canView(BRANCH_MANAGER, ownElsewhere)).toBe(true);
  });

  it('lets the branch manager read the routed detail, and 404s the rest', async () => {
    const ctx = buildContext();
    const routedTicket = await ctx.create.execute(REQUESTER, {
      title: 'Routed',
      description: 'D',
      branchId: TEST_BRANCH,
    });
    const unroutedTicket = await ctx.create.execute(REQUESTER, {
      title: 'Unrouted',
      description: 'D',
    });

    const detail = await ctx.get.execute(BRANCH_MANAGER, routedTicket.id);
    expect(detail.ticket.id).toBe(routedTicket.id);
    // The unrouted one answers not-found, not forbidden: existence hiding.
    await expect(
      ctx.get.execute(BRANCH_MANAGER, unroutedTicket.id),
    ).rejects.toThrow('Ticket not found');
  });
});

describe('ListTicketsUseCase — the branch list matrix', () => {
  async function seedTickets(ctx: ReturnType<typeof buildContext>) {
    const inMyBranch = await ctx.create.execute(REQUESTER, {
      title: 'In B',
      description: 'D',
      branchId: TEST_BRANCH,
    });
    const inOtherBranch = await ctx.create.execute(REQUESTER, {
      title: 'In C',
      description: 'D',
      branchId: OTHER_BRANCH,
    });
    const unrouted = await ctx.create.execute(REQUESTER, {
      title: 'Unrouted',
      description: 'D',
    });
    const own = await ctx.create.execute(BRANCH_MANAGER, {
      title: 'My own, unrouted',
      description: 'D',
    });
    return { inMyBranch, inOtherBranch, unrouted, own };
  }

  it('shows a branch manager their branch plus their own — never branch C, never the unrouted intake', async () => {
    const ctx = buildContext();
    const { inMyBranch, own } = await seedTickets(ctx);

    const page = await ctx.list.execute(BRANCH_MANAGER, {});

    expect(idsOf(page.items)).toEqual(idsOf([inMyBranch, own]));
    expect(page.total).toBe(2);
  });

  it('never crosses organizations, whatever the branch set claims', async () => {
    const ctx = buildContext();
    await seedTickets(ctx);
    // A manager of the OTHER organization whose token somehow names OUR
    // branch: the organization scope must reject before the branch scope
    // can admit.
    const foreignManager: Actor = {
      ...BRANCH_MANAGER,
      id: randomUUID(),
      organizationId: OTHER_ORGANIZATION,
      branchIds: new Set([TEST_BRANCH]),
    };

    const page = await ctx.list.execute(foreignManager, {});
    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  it('intersects a requested branch with the allowed set: outside answers the empty page', async () => {
    const ctx = buildContext();
    await seedTickets(ctx);

    // OTHER_BRANCH exists and has tickets — but it is outside the caller's
    // set, and the empty page must not distinguish it from a guessed id.
    for (const branchId of [OTHER_BRANCH, FOREIGN_BRANCH, randomUUID()]) {
      const page = await ctx.list.execute(BRANCH_MANAGER, { branchId });
      expect(page.items).toEqual([]);
      expect(page.total).toBe(0);
    }
  });

  it('honors a requested branch inside the set', async () => {
    const ctx = buildContext();
    const { inMyBranch, own } = await seedTickets(ctx);

    const page = await ctx.list.execute(BRANCH_MANAGER, {
      branchId: TEST_BRANCH,
    });

    // The narrowing keeps the visibility rule's own-tickets leg: own rows
    // are the caller's to see wherever (and whether) they were routed.
    expect(idsOf(page.items)).toEqual(idsOf([inMyBranch, own]));
  });

  it('scopes read_branch with an empty set to own tickets exactly as today', async () => {
    const ctx = buildContext();
    await seedTickets(ctx);
    const ownForEmpty = await ctx.create.execute(EMPTY_SET_MANAGER, {
      title: 'Mine',
      description: 'D',
    });

    const page = await ctx.list.execute(EMPTY_SET_MANAGER, {});
    expect(idsOf(page.items)).toEqual([ownForEmpty.id]);
  });

  it('lets read_all filter by branch, organization-wide (criterion 4)', async () => {
    const ctx = buildContext();
    const { inMyBranch, inOtherBranch } = await seedTickets(ctx);

    const everything = await ctx.list.execute(ADMIN, {});
    expect(everything.total).toBe(4);

    const filtered = await ctx.list.execute(ADMIN, { branchId: TEST_BRANCH });
    expect(idsOf(filtered.items)).toEqual([inMyBranch.id]);

    const other = await ctx.list.execute(ADMIN, { branchId: OTHER_BRANCH });
    expect(idsOf(other.items)).toEqual([inOtherBranch.id]);
  });
});

describe('pickers (D6)', () => {
  it('lists only the active branches of the caller organization, by name', async () => {
    const ctx = buildContext();
    ctx.branches.seed(
      aBranchRef({
        id: randomUUID(),
        name: 'Archived store',
        status: 'archived',
      }),
    );

    const items = await ctx.pickBranches.execute(REQUESTER);

    // FOREIGN_BRANCH and the archived row never appear; order is by name.
    expect(items).toEqual([
      { id: TEST_BRANCH, code: 'BR-12', name: 'Store 12' },
      { id: OTHER_BRANCH, code: 'BR-13', name: 'Store 13' },
    ]);
  });

  it('requires tickets.create — the picker exists to file a request', async () => {
    const ctx = buildContext();
    const auditor: Actor = {
      id: randomUUID(),
      organizationId: TEST_ORGANIZATION,
      permissions: new Set([PERMISSIONS.TICKETS_READ_ALL]),
    };

    await expect(ctx.pickBranches.execute(auditor)).rejects.toBeInstanceOf(
      ForbiddenTicketActionError,
    );
    await expect(
      ctx.pickStations.execute(auditor, TEST_BRANCH),
    ).rejects.toBeInstanceOf(ForbiddenTicketActionError);
  });

  it('lists a branch stations with their area, active only', async () => {
    const ctx = buildContext();
    ctx.stations.seed(
      aStationRef({
        id: randomUUID(),
        name: 'Retired till',
        status: 'archived',
      }),
    );

    const items = await ctx.pickStations.execute(REQUESTER, TEST_BRANCH);

    expect(items).toEqual([
      {
        id: TEST_STATION,
        code: 'CASH-2',
        name: 'Cashier station 2',
        area: 'checkout',
      },
    ]);
  });

  it('404s the stations of a foreign, archived or unknown branch alike', async () => {
    const ctx = buildContext();
    ctx.branches.seed(
      aBranchRef({ id: OTHER_BRANCH, name: 'Store 13', status: 'archived' }),
    );

    for (const branchId of [FOREIGN_BRANCH, OTHER_BRANCH, randomUUID()]) {
      await expect(
        ctx.pickStations.execute(REQUESTER, branchId),
      ).rejects.toBeInstanceOf(BranchNotFoundError);
    }
  });
});
