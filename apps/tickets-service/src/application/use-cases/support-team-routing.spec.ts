/**
 * The eight scenarios Sprint 9.12 was required to prove, one describe each.
 *
 * They are written as the product owner stated them rather than as branch
 * coverage, because that is what they are for: each one names a way the
 * support-team model could be wrong in a way nobody would notice until an
 * organization was using it.
 */
import { PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import {
  ForbiddenTicketActionError,
  InvalidTeamContextError,
  TicketNotFoundError,
} from '../../domain/errors';
import { canView, type Ticket } from '../../domain/ticket';
import {
  ACTIVE_REF_STATUS,
  type TeamRef,
} from '../ports/structure-refs.repository';
import {
  FixedClock,
  InMemoryTeamRefRepository,
  InMemoryTicketRepository,
} from '../testing/fakes';
import { aTicket, TEST_ORGANIZATION } from '../../testing/fixtures';
import { ListTicketsUseCase } from './ticket-queries';
import { RouteTicketUseCase } from './route-ticket';

const OTHER_ORGANIZATION = '00000000-0000-4000-8000-0000000000ff';
const STORE_A = '00000000-0000-4000-8000-0000000000a1';
const STORE_B = '00000000-0000-4000-8000-0000000000a2';
const CENTRAL_IT = '00000000-0000-4000-8000-0000000000c1';
const STORE_A_TEAM = '00000000-0000-4000-8000-0000000000c2';
const RIVAL_TEAM = '00000000-0000-4000-8000-0000000000c3';
const MANAGER = '00000000-0000-4000-8000-00000000d001';
const REQUESTER = '00000000-0000-4000-8000-00000000d002';

function team(overrides: Partial<TeamRef> = {}): TeamRef {
  return {
    id: CENTRAL_IT,
    organizationId: TEST_ORGANIZATION,
    name: 'Central IT',
    status: ACTIVE_REF_STATUS,
    // Empty is ORGANIZATION-WIDE, which is what makes this the central team.
    branchIds: [],
    updatedAt: new Date('2026-08-03T12:00:00.000Z'),
    ...overrides,
  };
}

/** A desk manager: read_team and routing.manage, no organization-wide read. */
function deskManager(teamIds: string[]): Actor {
  return {
    id: MANAGER,
    organizationId: TEST_ORGANIZATION,
    permissions: new Set([
      PERMISSIONS.TICKETS_READ_OWN,
      PERMISSIONS.TICKETS_READ_TEAM,
      PERMISSIONS.ROUTING_MANAGE,
    ]),
    teamIds: teamIds.length > 0 ? new Set(teamIds) : undefined,
  };
}

/** An agent as the product ships them today: the organization-wide read. */
function agent(): Actor {
  return {
    id: '00000000-0000-4000-8000-00000000d003',
    organizationId: TEST_ORGANIZATION,
    permissions: new Set([
      PERMISSIONS.TICKETS_READ_ALL,
      PERMISSIONS.TICKETS_READ_TEAM,
    ]),
  };
}

function build() {
  const tickets = new InMemoryTicketRepository();
  const teams = new InMemoryTeamRefRepository();
  const clock = new FixedClock(new Date('2026-08-03T12:00:00.000Z'));
  return {
    tickets,
    teams,
    route: new RouteTicketUseCase(tickets, teams, clock),
    list: new ListTicketsUseCase(tickets),
  };
}

async function seedTicket(
  ctx: ReturnType<typeof build>,
  overrides: Partial<Ticket> = {},
): Promise<Ticket> {
  const ticket = aTicket({ requesterId: REQUESTER, ...overrides });
  await ctx.tickets.create(ticket, {
    id: '00000000-0000-4000-8000-00000000f001',
    ticketId: ticket.id,
    organizationId: ticket.organizationId,
    actorId: ticket.requesterId,
    action: 'created',
    detail: null,
    createdAt: ticket.createdAt,
  });
  return ticket;
}

describe('1. a central support team sees tickets from several branches', () => {
  it('lists work filed under different stores', async () => {
    const ctx = build();
    ctx.teams.seed(team());
    const inA = await seedTicket(ctx, {
      branchId: STORE_A,
      assignedTeamId: CENTRAL_IT,
    });
    const inB = await seedTicket(ctx, {
      branchId: STORE_B,
      assignedTeamId: CENTRAL_IT,
    });

    const page = await ctx.list.execute(deskManager([CENTRAL_IT]), {});

    // One team, two branches: the case a branch-scoped department could not
    // have represented at all (ADR 0022).
    expect(page.items.map((item) => item.id).sort()).toEqual(
      [inA.id, inB.id].sort(),
    );
  });

  it('accepts a ticket from any branch, because its reach is empty', async () => {
    const ctx = build();
    ctx.teams.seed(team());
    const ticket = await seedTicket(ctx, { branchId: STORE_B });

    const routed = await ctx.route.execute(deskManager([CENTRAL_IT]), {
      ticketId: ticket.id,
      teamId: CENTRAL_IT,
    });

    expect(routed.assignedTeamId).toBe(CENTRAL_IT);
  });
});

describe('2. a branch-local team cannot see unauthorized branches', () => {
  it('refuses a ticket from a branch outside its reach', async () => {
    const ctx = build();
    ctx.teams.seed(team({ id: STORE_A_TEAM, branchIds: [STORE_A] }));
    const inB = await seedTicket(ctx, { branchId: STORE_B });

    // The property holds because the ticket is never assignable, not
    // because a read filters it out afterwards (ADR 0022).
    await expect(
      ctx.route.execute(deskManager([STORE_A_TEAM]), {
        ticketId: inB.id,
        teamId: STORE_A_TEAM,
      }),
    ).rejects.toBeInstanceOf(InvalidTeamContextError);
  });

  it('refuses a ticket with no branch at all', async () => {
    const ctx = build();
    ctx.teams.seed(team({ id: STORE_A_TEAM, branchIds: [STORE_A] }));
    const unplaced = await seedTicket(ctx, { branchId: null });

    // There is no branch to prove is in reach, so a scoped team cannot take
    // it. Unrouted intake stays with the organization-wide readers.
    await expect(
      ctx.route.execute(deskManager([STORE_A_TEAM]), {
        ticketId: unplaced.id,
        teamId: STORE_A_TEAM,
      }),
    ).rejects.toBeInstanceOf(InvalidTeamContextError);
  });

  it('never lists a ticket of a team the actor is not in', async () => {
    const ctx = build();
    const foreign = await seedTicket(ctx, {
      branchId: STORE_B,
      assignedTeamId: CENTRAL_IT,
      requesterId: '00000000-0000-4000-8000-00000000d0ff',
    });

    const page = await ctx.list.execute(deskManager([STORE_A_TEAM]), {});
    expect(page.items).toHaveLength(0);
    expect(canView(deskManager([STORE_A_TEAM]), foreign)).toBe(false);
  });
});

describe("3. a requester's department grants no support visibility", () => {
  it('shows a department member only their own tickets', async () => {
    const ctx = build();
    const mine = await seedTicket(ctx, {
      requesterId: MANAGER,
      branchId: STORE_A,
    });
    await seedTicket(ctx, { branchId: STORE_A, assignedTeamId: CENTRAL_IT });

    // The actor belongs to a department — which is modelled entirely
    // elsewhere and contributes NOTHING to the token's team set. Holding
    // read_team with no team membership therefore sees own tickets only.
    const departmentMemberOnly = deskManager([]);
    const page = await ctx.list.execute(departmentMemberOnly, {});

    expect(page.items.map((item) => item.id)).toEqual([mine.id]);
  });
});

describe('4. a team manager sees tickets assigned to their active teams', () => {
  it('lists the team queue plus their own tickets', async () => {
    const ctx = build();
    const queued = await seedTicket(ctx, {
      branchId: STORE_A,
      assignedTeamId: CENTRAL_IT,
    });
    const mine = await seedTicket(ctx, { requesterId: MANAGER });

    const page = await ctx.list.execute(deskManager([CENTRAL_IT]), {});

    // Both legs: the team's work, and their own requests wherever those
    // were filed. This is the hole the sprint closed — before it, this
    // template could assign tickets it could not list.
    expect(page.items.map((item) => item.id).sort()).toEqual(
      [queued.id, mine.id].sort(),
    );
  });

  it('answers the empty page for a team outside their set', async () => {
    const ctx = build();
    await seedTicket(ctx, { assignedTeamId: CENTRAL_IT, branchId: STORE_A });

    const page = await ctx.list.execute(deskManager([STORE_A_TEAM]), {
      assignedTeamId: CENTRAL_IT,
    });

    // Never an error: a 4xx would confirm the team exists.
    expect(page).toEqual({ items: [], total: 0 });
  });
});

describe('5. leaving or being suspended from a team ends the access', () => {
  it('stops listing the team queue once the team set is gone', async () => {
    const ctx = build();
    const queued = await seedTicket(ctx, {
      branchId: STORE_A,
      assignedTeamId: CENTRAL_IT,
    });

    const inTeam = await ctx.list.execute(deskManager([CENTRAL_IT]), {});
    expect(inTeam.items.map((item) => item.id)).toEqual([queued.id]);

    // Removed from the team, or suspended from the organization: either way
    // the next token carries no team set, and absence DENIES. The change
    // takes effect at the next mint, not instantly — the same bounded
    // staleness every claim has (ADR 0014).
    const removed = await ctx.list.execute(deskManager([]), {});
    expect(removed.items).toHaveLength(0);
    expect(canView(deskManager([]), queued)).toBe(false);
  });
});

describe('6. organization A cannot reference or assign organization B team', () => {
  it('refuses a team belonging to another organization', async () => {
    const ctx = build();
    ctx.teams.seed(
      team({ id: RIVAL_TEAM, organizationId: OTHER_ORGANIZATION }),
    );
    const ticket = await seedTicket(ctx, { branchId: STORE_A });

    // The projection lookup is organization-scoped, so a foreign team and a
    // team that never existed answer the same generic refusal.
    await expect(
      ctx.route.execute(deskManager([CENTRAL_IT]), {
        ticketId: ticket.id,
        teamId: RIVAL_TEAM,
      }),
    ).rejects.toBeInstanceOf(InvalidTeamContextError);
  });

  it('refuses an archived team the same way', async () => {
    const ctx = build();
    ctx.teams.seed(team({ status: 'archived' }));
    const ticket = await seedTicket(ctx, { branchId: STORE_A });

    await expect(
      ctx.route.execute(deskManager([CENTRAL_IT]), {
        ticketId: ticket.id,
        teamId: CENTRAL_IT,
      }),
    ).rejects.toBeInstanceOf(InvalidTeamContextError);
  });

  it('hides a ticket of another organization behind the same not-found', async () => {
    const ctx = build();
    ctx.teams.seed(team());
    const foreign = await seedTicket(ctx, {
      organizationId: OTHER_ORGANIZATION,
      branchId: STORE_A,
    });

    await expect(
      ctx.route.execute(deskManager([CENTRAL_IT]), {
        ticketId: foreign.id,
        teamId: CENTRAL_IT,
      }),
    ).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  it('refuses routing to somebody without routing.manage', async () => {
    const ctx = build();
    ctx.teams.seed(team());
    const ticket = await seedTicket(ctx, {
      branchId: STORE_A,
      requesterId: MANAGER,
    });

    await expect(
      ctx.route.execute(
        {
          ...deskManager([CENTRAL_IT]),
          permissions: new Set([PERMISSIONS.TICKETS_READ_OWN]),
        },
        { ticketId: ticket.id, teamId: CENTRAL_IT },
      ),
    ).rejects.toBeInstanceOf(ForbiddenTicketActionError);
  });
});

describe('7. an organization with no teams keeps the agent experience', () => {
  it('leaves the organization-wide read exactly as it was', async () => {
    const ctx = build();
    const one = await seedTicket(ctx, { branchId: STORE_A });
    const two = await seedTicket(ctx, { branchId: null });

    // No team exists, no ticket is routed, and the agent still sees every
    // ticket in the organization. Sprint 9.12 deliberately did NOT shrink
    // agents to read_team (D4), so nothing about this changed.
    const page = await ctx.list.execute(agent(), {});

    expect(page.items.map((item) => item.id).sort()).toEqual(
      [one.id, two.id].sort(),
    );
  });
});

describe('8. existing tickets stay valid after the migration', () => {
  it('treats a null team as the ordinary unrouted state', async () => {
    const ctx = build();
    const legacy = await seedTicket(ctx, { branchId: STORE_A });

    expect(legacy.assignedTeamId).toBeNull();
    // Visible to the organization-wide read and to its requester, exactly
    // as before: a null team is a permanently legitimate state, not a gap.
    expect(canView(agent(), legacy)).toBe(true);
    expect(
      canView({ ...deskManager([CENTRAL_IT]), id: legacy.requesterId }, legacy),
    ).toBe(true);
    // And invisible to a team read, because nobody placed it.
    expect(canView(deskManager([CENTRAL_IT]), legacy)).toBe(false);
  });

  it('can be routed later without anything having been backfilled', async () => {
    const ctx = build();
    ctx.teams.seed(team());
    const legacy = await seedTicket(ctx, { branchId: STORE_A });

    const routed = await ctx.route.execute(deskManager([CENTRAL_IT]), {
      ticketId: legacy.id,
      teamId: CENTRAL_IT,
    });
    expect(routed.assignedTeamId).toBe(CENTRAL_IT);

    const cleared = await ctx.route.execute(deskManager([CENTRAL_IT]), {
      ticketId: legacy.id,
      teamId: null,
    });
    expect(cleared.assignedTeamId).toBeNull();
  });
});
