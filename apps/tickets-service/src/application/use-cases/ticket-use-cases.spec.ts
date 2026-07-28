import {
  ForbiddenTicketActionError,
  InvalidStatusTransitionError,
  TicketNotFoundError,
} from '../../domain/errors';
import { canTransition, type Actor } from '../../domain/ticket';
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
};
const OTHER_USER: Actor = {
  id: '22222222-2222-4222-8222-222222222222',
  roles: ['user'],
};
const AGENT: Actor = {
  id: '33333333-3333-4333-8333-333333333333',
  roles: ['agent'],
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
      },
    ]);
    expect(ctx.events.assigned).toEqual([
      {
        ticketId: ticket.id,
        actorId: AGENT.id,
        assigneeId: AGENT.id,
        assignedAt: ctx.clock.now(),
      },
    ]);
    expect(ctx.events.commentsAdded).toEqual([
      {
        ticketId: ticket.id,
        commentId: comment.id,
        authorId: REQUESTER.id,
        internal: false,
        addedAt: ctx.clock.now(),
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

    const forAgent = await ctx.get.execute(AGENT, ticket.id);
    expect(forAgent.comments).toHaveLength(2);
    expect(forAgent.history.map((h) => h.action)).toEqual([
      'created',
      'comment_added',
      'comment_added',
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
