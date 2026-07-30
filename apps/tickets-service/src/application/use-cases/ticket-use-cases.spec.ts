import {
  ForbiddenTicketActionError,
  InvalidStatusTransitionError,
  NoOrganizationContextError,
  TicketNotFoundError,
} from '../../domain/errors';
import {
  canTransition,
  requireOrganizationOf,
  type Actor,
} from '../../domain/ticket';
import { OTHER_ORGANIZATION, TEST_ORGANIZATION } from '../../testing/fixtures';
import {
  FakeEventPublisher,
  FixedClock,
  InMemoryTicketRepository,
} from '../testing/fakes';
import { AddCommentUseCase } from './add-comment';
import { CreateTicketUseCase } from './create-ticket';
import { GetTicketUseCase, ListTicketsUseCase } from './ticket-queries';
import {
  AssignTicketUseCase,
  ChangeTicketStatusUseCase,
} from './ticket-lifecycle';

const REQUESTER: Actor = {
  id: '11111111-1111-4111-8111-111111111111',
  roles: ['user'],
  organizationId: TEST_ORGANIZATION,
};
const OTHER_USER: Actor = {
  id: '22222222-2222-4222-8222-222222222222',
  roles: ['user'],
  organizationId: TEST_ORGANIZATION,
};
const AGENT: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  roles: ['agent'],
  organizationId: TEST_ORGANIZATION,
};
/** Staff, but acting in a different tenant. */
const FOREIGN_AGENT: Actor = {
  id: '44444444-4444-4444-8444-444444444444',
  roles: ['agent'],
  organizationId: OTHER_ORGANIZATION,
};
/** Authenticated, but between registering and getting a membership. */
const TENANTLESS_USER: Actor = {
  id: '55555555-5555-4555-8555-555555555555',
  roles: ['user'],
};

function buildContext() {
  const tickets = new InMemoryTicketRepository();
  const clock = new FixedClock(new Date('2026-07-28T12:00:00.000Z'));
  const events = new FakeEventPublisher();
  return {
    tickets,
    clock,
    events,
    create: new CreateTicketUseCase(tickets, clock, events),
    get: new GetTicketUseCase(tickets),
    listTickets: new ListTicketsUseCase(tickets),
    changeStatus: new ChangeTicketStatusUseCase(tickets, clock, events),
    assign: new AssignTicketUseCase(tickets, clock, events),
    comment: new AddCommentUseCase(tickets, clock, events),
  };
}

describe('domain event publication', () => {
  it('publishes one event per persisted mutation, none on rejection', async () => {
    const ctx = buildContext();

    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'Printer on fire',
      description: 'Third floor, again',
    });
    await ctx.changeStatus.execute(AGENT, ticket.id, 'in_progress');
    await ctx.assign.execute(AGENT, ticket.id, AGENT.id);
    const comment = await ctx.comment.execute(REQUESTER, ticket.id, {
      body: 'Any update?',
    });

    expect(ctx.events.created).toEqual([
      {
        ticketId: ticket.id,
        requesterId: REQUESTER.id,
        title: 'Printer on fire',
        priority: 'medium',
        status: 'open',
        organizationId: TEST_ORGANIZATION,
        createdAt: ctx.clock.now(),
      },
    ]);
    expect(ctx.events.statusChanged).toEqual([
      {
        ticketId: ticket.id,
        actorId: AGENT.id,
        fromStatus: 'open',
        toStatus: 'in_progress',
        changedAt: ctx.clock.now(),
        organizationId: TEST_ORGANIZATION,
      },
    ]);
    expect(ctx.events.assigned).toEqual([
      {
        ticketId: ticket.id,
        actorId: AGENT.id,
        assigneeId: AGENT.id,
        assignedAt: ctx.clock.now(),
        organizationId: TEST_ORGANIZATION,
      },
    ]);
    expect(ctx.events.commentsAdded).toEqual([
      {
        ticketId: ticket.id,
        commentId: comment.id,
        authorId: REQUESTER.id,
        internal: false,
        addedAt: ctx.clock.now(),
        organizationId: TEST_ORGANIZATION,
      },
    ]);

    // A rejected transition must not leak an event.
    await expect(
      ctx.changeStatus.execute(AGENT, ticket.id, 'closed'),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
    expect(ctx.events.statusChanged).toHaveLength(1);
  });
});

describe('status transition rules', () => {
  it('allows only the documented lifecycle moves', () => {
    expect(canTransition('open', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'resolved')).toBe(true);
    expect(canTransition('resolved', 'open')).toBe(true);
    expect(canTransition('resolved', 'closed')).toBe(true);
    expect(canTransition('open', 'resolved')).toBe(false);
    expect(canTransition('closed', 'open')).toBe(false);
  });
});

describe('CreateTicketUseCase', () => {
  it('opens a ticket for the actor with defaults and a history entry', async () => {
    const ctx = buildContext();

    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'Printer on fire',
      description: 'It is very much on fire.',
    });

    expect(ticket.status).toBe('open');
    expect(ticket.priority).toBe('medium');
    expect(ticket.requesterId).toBe(REQUESTER.id);
    expect(ctx.tickets.history[0]).toMatchObject({
      ticketId: ticket.id,
      action: 'created',
      actorId: REQUESTER.id,
    });
  });
});

describe('writes require a tenant', () => {
  it('refuses to open a ticket for a caller with no organization', async () => {
    const ctx = buildContext();

    // Reachable in ordinary use: this is every account between registering
    // and organizations-service consuming the registration event.
    await expect(
      ctx.create.execute(TENANTLESS_USER, { title: 'T', description: 'D' }),
    ).rejects.toBeInstanceOf(NoOrganizationContextError);
    expect(ctx.tickets.tickets.size).toBe(0);
    expect(ctx.events.created).toEqual([]);
  });

  it('stamps the caller organization on the ticket and its history', async () => {
    const ctx = buildContext();

    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });

    expect(ticket.organizationId).toBe(TEST_ORGANIZATION);
    expect(ctx.tickets.history[0].organizationId).toBe(TEST_ORGANIZATION);
  });

  it('takes a child row organization from the ticket, not from the writer', async () => {
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });

    const comment = await ctx.comment.execute(AGENT, ticket.id, {
      body: 'looking into it',
    });

    // A comment belongs to its ticket's tenant regardless of who wrote it.
    // The event contracts could not make this distinction yet — a ticket
    // event carried the caller's organization because the ticket had none.
    expect(comment.organizationId).toBe(ticket.organizationId);
  });

  it('hides a ticket in another organization behind the not-found answer', async () => {
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });

    // Not "forbidden": the scoped read never returns the row, so staff in
    // another organization cannot even learn that it exists. Confirming
    // existence is the leak, so the weaker-sounding error is the right one.
    for (const attempt of [
      ctx.comment.execute(FOREIGN_AGENT, ticket.id, { body: 'hello' }),
      ctx.changeStatus.execute(FOREIGN_AGENT, ticket.id, 'in_progress'),
      ctx.assign.execute(FOREIGN_AGENT, ticket.id, AGENT.id),
      ctx.get.execute(FOREIGN_AGENT, ticket.id),
    ]) {
      await expect(attempt).rejects.toBeInstanceOf(TicketNotFoundError);
    }

    expect(ctx.events.commentsAdded).toEqual([]);
    expect(ctx.events.statusChanged).toEqual([]);
    expect(ctx.events.assigned).toEqual([]);
  });
});

describe('requireOrganizationOf', () => {
  const ticket = {
    id: 'ticket',
    organizationId: TEST_ORGANIZATION,
  } as Parameters<typeof requireOrganizationOf>[1];

  it('returns the ticket organization when the caller is acting in it', () => {
    expect(requireOrganizationOf(AGENT, ticket)).toBe(TEST_ORGANIZATION);
  });

  it('refuses a caller acting in a different organization', () => {
    // Unreachable through the read path now that findById is scoped, and
    // tested here for exactly that reason: it is the second gate, and a
    // second gate nothing exercises is a second gate nobody notices breaking.
    expect(() => requireOrganizationOf(FOREIGN_AGENT, ticket)).toThrow(
      ForbiddenTicketActionError,
    );
  });

  it('refuses a caller with no organization at all', () => {
    expect(() => requireOrganizationOf(TENANTLESS_USER, ticket)).toThrow(
      NoOrganizationContextError,
    );
  });
});

describe('GetTicketUseCase', () => {
  it('hides other users tickets behind 404 and filters internal notes', async () => {
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });
    await ctx.comment.execute(AGENT, ticket.id, {
      body: 'public reply',
      internal: false,
    });
    await ctx.comment.execute(AGENT, ticket.id, {
      body: 'internal note',
      internal: true,
    });

    await expect(ctx.get.execute(OTHER_USER, ticket.id)).rejects.toBeInstanceOf(
      TicketNotFoundError,
    );

    const forRequester = await ctx.get.execute(REQUESTER, ticket.id);
    expect(forRequester.comments.map((c) => c.body)).toEqual(['public reply']);

    // Hiding the body is not enough. The internal note also wrote a history
    // entry, and returning it would tell the requester that staff wrote
    // something private about their ticket, who wrote it and when.
    expect(forRequester.history.map((h) => h.action)).toEqual([
      'created',
      'comment_added',
    ]);
    expect(forRequester.history.some((h) => h.detail === 'internal')).toBe(
      false,
    );

    const forAgent = await ctx.get.execute(AGENT, ticket.id);
    expect(forAgent.comments).toHaveLength(2);
    expect(forAgent.history.map((h) => h.action)).toEqual([
      'created',
      'comment_added',
      'comment_added',
    ]);
    // Staff still see the whole trail, including that the note happened.
    expect(
      forAgent.history.filter((h) => h.detail === 'internal'),
    ).toHaveLength(1);
  });

  it('keeps every non-comment history entry visible to the requester', async () => {
    // The filter must be narrow: a requester still needs to see that their
    // ticket was created, assigned and moved. Only the internal-note entry
    // disappears.
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });
    await ctx.assign.execute(AGENT, ticket.id, AGENT.id);
    await ctx.changeStatus.execute(AGENT, ticket.id, 'in_progress');
    await ctx.comment.execute(AGENT, ticket.id, {
      body: 'internal note',
      internal: true,
    });

    const forRequester = await ctx.get.execute(REQUESTER, ticket.id);
    expect(forRequester.history.map((h) => h.action)).toEqual([
      'created',
      'assigned',
      'status_changed',
    ]);
  });
});

describe('ListTicketsUseCase', () => {
  it('scopes requesters to their own tickets and lets staff filter freely', async () => {
    const ctx = buildContext();
    await ctx.create.execute(REQUESTER, { title: 'Mine', description: 'D' });
    await ctx.create.execute(OTHER_USER, { title: 'Theirs', description: 'D' });

    const mine = await ctx.listTickets.execute(REQUESTER, {});
    expect(mine.total).toBe(1);
    expect(mine.items[0].title).toBe('Mine');

    const all = await ctx.listTickets.execute(AGENT, {});
    expect(all.total).toBe(2);

    const open = await ctx.listTickets.execute(AGENT, { status: 'open' });
    expect(open.total).toBe(2);
  });
});

describe('ChangeTicketStatusUseCase', () => {
  it('lets staff walk the lifecycle and records history details', async () => {
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });

    await ctx.changeStatus.execute(AGENT, ticket.id, 'in_progress');
    const resolved = await ctx.changeStatus.execute(
      AGENT,
      ticket.id,
      'resolved',
    );
    expect(resolved.status).toBe('resolved');
    expect(ctx.tickets.history.at(-1)?.detail).toBe('in_progress -> resolved');
  });

  it('rejects illegal transitions', async () => {
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });

    await expect(
      ctx.changeStatus.execute(AGENT, ticket.id, 'resolved'),
    ).rejects.toBeInstanceOf(InvalidStatusTransitionError);
  });

  it('lets a requester close only their own resolved ticket', async () => {
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });

    // Not resolved yet: the requester cannot drive the lifecycle.
    await expect(
      ctx.changeStatus.execute(REQUESTER, ticket.id, 'closed'),
    ).rejects.toBeInstanceOf(ForbiddenTicketActionError);

    await ctx.changeStatus.execute(AGENT, ticket.id, 'in_progress');
    await ctx.changeStatus.execute(AGENT, ticket.id, 'resolved');

    const closed = await ctx.changeStatus.execute(
      REQUESTER,
      ticket.id,
      'closed',
    );
    expect(closed.status).toBe('closed');
  });
});

describe('AssignTicketUseCase', () => {
  it('is staff-only and records assignment history', async () => {
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });

    await expect(
      ctx.assign.execute(REQUESTER, ticket.id, AGENT.id),
    ).rejects.toBeInstanceOf(ForbiddenTicketActionError);

    const assigned = await ctx.assign.execute(AGENT, ticket.id, AGENT.id);
    expect(assigned.assigneeId).toBe(AGENT.id);

    const unassigned = await ctx.assign.execute(AGENT, ticket.id, null);
    expect(unassigned.assigneeId).toBeNull();
    expect(ctx.tickets.history.at(-1)?.detail).toBe('unassigned');
  });
});

describe('AddCommentUseCase', () => {
  it('blocks internal notes from non-staff authors', async () => {
    const ctx = buildContext();
    const ticket = await ctx.create.execute(REQUESTER, {
      title: 'T',
      description: 'D',
    });

    await expect(
      ctx.comment.execute(REQUESTER, ticket.id, {
        body: 'sneaky',
        internal: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenTicketActionError);

    const publicComment = await ctx.comment.execute(REQUESTER, ticket.id, {
      body: 'any update?',
    });
    expect(publicComment.internal).toBe(false);
  });
});
