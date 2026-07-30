import { randomUUID } from 'node:crypto';
import {
  aComment,
  aHistoryEntry,
  aTicket,
  idsOf,
} from '../../testing/fixtures';
import { PrismaTicketRepository } from './prisma-ticket.repository';
import { PrismaService } from './prisma.service';

// Runs against helpdesk_tickets_test through the test-integration target.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run via `nx run @helpdesk-ai/tickets-service:test-integration` with the compose postgres service up.',
  );
}

describe('PrismaTicketRepository (real PostgreSQL)', () => {
  const prisma = new PrismaService(databaseUrl);
  const repository = new PrismaTicketRepository(prisma);

  beforeEach(async () => {
    await prisma.ticketHistoryEntry.deleteMany();
    await prisma.ticketComment.deleteMany();
    await prisma.ticket.deleteMany();
  });

  afterAll(async () => {
    await prisma.ticketHistoryEntry.deleteMany();
    await prisma.ticketComment.deleteMany();
    await prisma.ticket.deleteMany();
    await prisma.$disconnect();
  });

  it('persists tickets with enums, nullables and history atomically', async () => {
    const ticket = aTicket();
    await repository.create(ticket, aHistoryEntry(ticket));

    const found = await repository.findById(ticket.id);
    expect(found).toMatchObject({
      id: ticket.id,
      status: 'open',
      priority: 'high',
      category: 'hardware',
      assigneeId: null,
    });

    const history = await repository.historyFor(ticket.id);
    expect(history.map((h) => h.action)).toEqual(['created']);
  });

  it("returns only the requester's rows, by id, never a foreign one", async () => {
    // Asserting the ids rather than the count is the whole point of this
    // test. Verified by mutation: dropping the scope from `findMany` while
    // leaving it on `count` keeps every total correct, so the previous
    // count-based assertions passed against a repository that returned
    // another requester's rows. These fail on it.
    const requester = randomUUID();
    const own = [
      aTicket({ requesterId: requester, status: 'closed' }),
      aTicket({ requesterId: requester }),
      aTicket({ requesterId: requester }),
    ];
    for (const ticket of own) {
      await repository.create(ticket, aHistoryEntry(ticket));
    }
    const foreign = aTicket();
    await repository.create(foreign, aHistoryEntry(foreign));

    const page = await repository.list({
      requesterId: requester,
      skip: 0,
      take: 10,
    });

    expect(idsOf(page.items)).toEqual(idsOf(own));
    expect(page.items.map((t) => t.id)).not.toContain(foreign.id);
    expect(page.total).toBe(3);
  });

  it('applies the status filter within the requester scope, not across it', async () => {
    const requester = randomUUID();
    const openOwn = aTicket({ requesterId: requester });
    const closedOwn = aTicket({ requesterId: requester, status: 'closed' });
    // Same status as the row we want, different owner: if the status filter
    // is ever applied without the owner predicate, this row shows up.
    const openForeign = aTicket();
    for (const ticket of [openOwn, closedOwn, openForeign]) {
      await repository.create(ticket, aHistoryEntry(ticket));
    }

    const page = await repository.list({
      requesterId: requester,
      status: 'open',
      skip: 0,
      take: 10,
    });

    expect(idsOf(page.items)).toEqual([openOwn.id]);
    expect(page.total).toBe(1);
  });

  it('paginates without widening the scope', async () => {
    const requester = randomUUID();
    const own = [
      aTicket({ requesterId: requester }),
      aTicket({ requesterId: requester }),
    ];
    for (const ticket of own) {
      await repository.create(ticket, aHistoryEntry(ticket));
    }
    const foreign = aTicket();
    await repository.create(foreign, aHistoryEntry(foreign));

    const firstPage = await repository.list({
      requesterId: requester,
      skip: 0,
      take: 1,
    });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.total).toBe(2);
    expect(idsOf(own)).toContain(firstPage.items[0].id);
  });

  it('returns every ticket when no requester filter is passed', async () => {
    // Documenting the fail-open shape rather than endorsing it. `list` builds
    // its predicate from optional spreads, so omitting the scope returns the
    // whole table. That is correct for staff today and is precisely what the
    // tenancy migration has to remove — when the organization scope becomes
    // required, this test must be rewritten deliberately rather than quietly
    // continuing to pass.
    const mine = aTicket();
    const theirs = aTicket();
    for (const ticket of [mine, theirs]) {
      await repository.create(ticket, aHistoryEntry(ticket));
    }

    const page = await repository.list({ skip: 0, take: 10 });

    expect(idsOf(page.items)).toEqual(idsOf([mine, theirs]));
  });

  it('updates lifecycle fields and appends history', async () => {
    const ticket = aTicket();
    await repository.create(ticket, aHistoryEntry(ticket));

    await repository.update(
      { ...ticket, status: 'in_progress', assigneeId: randomUUID() },
      aHistoryEntry(ticket, { action: 'status_changed' }),
    );

    const found = await repository.findById(ticket.id);
    expect(found?.status).toBe('in_progress');
    expect(found?.assigneeId).not.toBeNull();
    expect(await repository.historyFor(ticket.id)).toHaveLength(2);
  });

  it('separates internal and public comments by identity, not by count', async () => {
    const ticket = aTicket();
    await repository.create(ticket, aHistoryEntry(ticket));

    const publicReply = aComment(ticket, { body: 'public' });
    const internalNote = aComment(ticket, { body: 'internal', internal: true });
    for (const comment of [publicReply, internalNote]) {
      await repository.addComment(
        comment,
        aHistoryEntry(ticket, { action: 'comment_added' }),
      );
    }

    // A count assertion cannot tell "the public one" from "one of them".
    const requesterView = await repository.commentsFor(ticket.id, false);
    expect(idsOf(requesterView)).toEqual([publicReply.id]);
    expect(requesterView.map((c) => c.body)).not.toContain('internal');

    const staffView = await repository.commentsFor(ticket.id, true);
    expect(idsOf(staffView)).toEqual(idsOf([publicReply, internalNote]));
  });
});
