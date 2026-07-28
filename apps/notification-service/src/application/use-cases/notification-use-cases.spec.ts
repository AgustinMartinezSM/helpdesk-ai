import type { Actor } from '@helpdesk-ai/security';
import {
  MissingTicketRefError,
  NotificationNotFoundError,
} from '../../domain/errors';
import {
  FixedClock,
  InMemoryNotificationRepository,
  InMemoryTicketRefRepository,
} from '../testing/fakes';
import {
  ListMyNotificationsUseCase,
  MarkNotificationReadUseCase,
} from './notification-queries';
import {
  NotifyAssignedUseCase,
  NotifyCommentAddedUseCase,
  NotifyStatusChangedUseCase,
  RegisterTicketRefUseCase,
} from './project-ticket-events';

const REQUESTER = '11111111-1111-4111-8111-111111111111';
const AGENT = '33333333-3333-4333-8333-333333333333';
const TICKET = '5f0c9a52-77aa-4a30-b87e-6a3c5be2b222';
const EVENT_A = '7c1f0b7e-4d29-4b7e-8a3f-9a1b2c3d4e5f';
const EVENT_B = '00000000-0000-4000-8000-000000000002';

function buildContext() {
  const refs = new InMemoryTicketRefRepository();
  const notifications = new InMemoryNotificationRepository();
  const clock = new FixedClock(new Date('2026-07-28T12:00:05.000Z'));
  const deps = { refs, notifications, clock };
  return {
    refs,
    notifications,
    clock,
    registerRef: new RegisterTicketRefUseCase(refs),
    statusChanged: new NotifyStatusChangedUseCase(deps),
    assigned: new NotifyAssignedUseCase(deps),
    commentAdded: new NotifyCommentAddedUseCase(deps),
  };
}

async function seedRef(ctx: ReturnType<typeof buildContext>) {
  await ctx.registerRef.execute({ ticketId: TICKET, requesterId: REQUESTER });
}

describe('status change notifications', () => {
  it('notifies the requester when staff move their ticket', async () => {
    const ctx = buildContext();
    await seedRef(ctx);

    const created = await ctx.statusChanged.execute({
      sourceEventId: EVENT_A,
      ticketId: TICKET,
      actorId: AGENT,
      fromStatus: 'open',
      toStatus: 'in_progress',
    });

    expect(created).toMatchObject({
      userId: REQUESTER,
      type: 'ticket-status-changed',
      ticketId: TICKET,
      message: 'Your ticket moved from open to in_progress',
      sourceEventId: EVENT_A,
      readAt: null,
    });
    expect(ctx.notifications.notifications).toHaveLength(1);
  });

  it('never notifies the requester about their own transition', async () => {
    const ctx = buildContext();
    await seedRef(ctx);

    const result = await ctx.statusChanged.execute({
      sourceEventId: EVENT_A,
      ticketId: TICKET,
      actorId: REQUESTER,
      fromStatus: 'resolved',
      toStatus: 'closed',
    });

    expect(result).toBeNull();
    expect(ctx.notifications.notifications).toHaveLength(0);
  });

  it('dead-letters (throws) when the ticket ref is missing', async () => {
    const ctx = buildContext();

    await expect(
      ctx.statusChanged.execute({
        sourceEventId: EVENT_A,
        ticketId: TICKET,
        actorId: AGENT,
        fromStatus: 'open',
        toStatus: 'in_progress',
      }),
    ).rejects.toBeInstanceOf(MissingTicketRefError);
  });

  it('collapses redelivery of the same event into one notification', async () => {
    const ctx = buildContext();
    await seedRef(ctx);
    const input = {
      sourceEventId: EVENT_A,
      ticketId: TICKET,
      actorId: AGENT,
      fromStatus: 'open',
      toStatus: 'in_progress',
    };

    await ctx.statusChanged.execute(input);
    await ctx.statusChanged.execute(input);

    expect(ctx.notifications.notifications).toHaveLength(1);
  });
});

describe('assignment notifications', () => {
  it('notifies the new assignee, skipping self-assignment and unassignment', async () => {
    const ctx = buildContext();

    const toOther = await ctx.assigned.execute({
      sourceEventId: EVENT_A,
      ticketId: TICKET,
      actorId: REQUESTER,
      assigneeId: AGENT,
    });
    expect(toOther).toMatchObject({ userId: AGENT, type: 'ticket-assigned' });

    const selfAssign = await ctx.assigned.execute({
      sourceEventId: EVENT_B,
      ticketId: TICKET,
      actorId: AGENT,
      assigneeId: AGENT,
    });
    expect(selfAssign).toBeNull();

    const unassign = await ctx.assigned.execute({
      sourceEventId: '00000000-0000-4000-8000-000000000003',
      ticketId: TICKET,
      actorId: AGENT,
      assigneeId: null,
    });
    expect(unassign).toBeNull();

    expect(ctx.notifications.notifications).toHaveLength(1);
  });
});

describe('comment notifications', () => {
  it('notifies the requester about staff comments, never about internal notes or their own', async () => {
    const ctx = buildContext();
    await seedRef(ctx);

    const staffComment = await ctx.commentAdded.execute({
      sourceEventId: EVENT_A,
      ticketId: TICKET,
      authorId: AGENT,
      internal: false,
    });
    expect(staffComment).toMatchObject({
      userId: REQUESTER,
      type: 'ticket-comment-added',
    });

    const internalNote = await ctx.commentAdded.execute({
      sourceEventId: EVENT_B,
      ticketId: TICKET,
      authorId: AGENT,
      internal: true,
    });
    expect(internalNote).toBeNull();

    const ownComment = await ctx.commentAdded.execute({
      sourceEventId: '00000000-0000-4000-8000-000000000003',
      ticketId: TICKET,
      authorId: REQUESTER,
      internal: false,
    });
    expect(ownComment).toBeNull();

    expect(ctx.notifications.notifications).toHaveLength(1);
  });

  it('does not even resolve the ref for internal notes', async () => {
    const ctx = buildContext();
    // No ref seeded: an internal note must return null, not dead-letter.
    const result = await ctx.commentAdded.execute({
      sourceEventId: EVENT_A,
      ticketId: TICKET,
      authorId: AGENT,
      internal: true,
    });
    expect(result).toBeNull();
  });
});

describe('notification queries', () => {
  const actor: Actor = { id: REQUESTER, roles: ['user'] };
  const stranger: Actor = { id: AGENT, roles: ['agent'] };

  it('lists own notifications newest first and marks them read once', async () => {
    const ctx = buildContext();
    await seedRef(ctx);
    const first = await ctx.statusChanged.execute({
      sourceEventId: EVENT_A,
      ticketId: TICKET,
      actorId: AGENT,
      fromStatus: 'open',
      toStatus: 'in_progress',
    });
    ctx.clock.advanceSeconds(60);
    await ctx.statusChanged.execute({
      sourceEventId: EVENT_B,
      ticketId: TICKET,
      actorId: AGENT,
      fromStatus: 'in_progress',
      toStatus: 'resolved',
    });

    const list = new ListMyNotificationsUseCase(ctx.notifications);
    const mine = await list.execute(actor, 50);
    expect(mine.map((n) => n.sourceEventId)).toEqual([EVENT_B, EVENT_A]);

    const markRead = new MarkNotificationReadUseCase(
      ctx.notifications,
      ctx.clock,
    );
    const read = await markRead.execute(actor, first!.id);
    expect(read.readAt).toEqual(ctx.clock.now());

    // Second read keeps the original timestamp.
    ctx.clock.advanceSeconds(60);
    const again = await markRead.execute(actor, first!.id);
    expect(again.readAt).toEqual(read.readAt);

    // Someone else's notification is a 404, not a 403: existence never leaks.
    await expect(markRead.execute(stranger, first!.id)).rejects.toBeInstanceOf(
      NotificationNotFoundError,
    );
  });
});
