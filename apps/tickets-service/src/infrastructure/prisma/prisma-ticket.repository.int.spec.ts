import { randomUUID } from 'node:crypto';
import {
  aComment,
  aHistoryEntry,
  aTicket,
  idsOf,
  OTHER_ORGANIZATION,
  TEST_ORGANIZATION,
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

    const found = await repository.findById(TEST_ORGANIZATION, ticket.id);
    expect(found).toMatchObject({
      id: ticket.id,
      status: 'open',
      priority: 'high',
      category: 'hardware',
      assigneeId: null,
    });

    const history = await repository.historyFor(ticket.id, true);
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
      organizationId: TEST_ORGANIZATION,
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
      organizationId: TEST_ORGANIZATION,
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
      organizationId: TEST_ORGANIZATION,
      requesterId: requester,
      skip: 0,
      take: 1,
    });

    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.total).toBe(2);
    expect(idsOf(own)).toContain(firstPage.items[0].id);
  });

  it('returns every ticket in the organization when no requester filter is passed', async () => {
    // This test used to document the fail-open shape: `list` built its
    // predicate from optional spreads, so omitting the scope returned the
    // whole table, and its own comment said it had to be rewritten
    // deliberately when the organization scope became required. This is that
    // rewrite. The unscoped call it used to make no longer compiles.
    const mine = aTicket();
    const theirs = aTicket();
    for (const ticket of [mine, theirs]) {
      await repository.create(ticket, aHistoryEntry(ticket));
    }

    const page = await repository.list({
      organizationId: TEST_ORGANIZATION,
      skip: 0,
      take: 10,
    });

    expect(idsOf(page.items)).toEqual(idsOf([mine, theirs]));
  });

  it('never returns a ticket from another organization, by id or by list', async () => {
    // The two-organization assertion the migration was written for. Asserted
    // by identity rather than by count: a count of "one" cannot tell the
    // right ticket from the wrong one.
    const ours = aTicket();
    const theirs = aTicket({ organizationId: OTHER_ORGANIZATION });
    // Same requester in both, so nothing but the organization can be doing
    // the filtering.
    const shared = aTicket({
      organizationId: OTHER_ORGANIZATION,
      requesterId: ours.requesterId,
    });
    for (const ticket of [ours, theirs, shared]) {
      await repository.create(ticket, aHistoryEntry(ticket));
    }

    const page = await repository.list({
      organizationId: TEST_ORGANIZATION,
      skip: 0,
      take: 10,
    });
    expect(idsOf(page.items)).toEqual([ours.id]);
    expect(page.total).toBe(1);

    // A foreign ticket answers null, exactly as a missing one does —
    // a 404 rather than a 403, so existence is not confirmed.
    expect(await repository.findById(TEST_ORGANIZATION, theirs.id)).toBeNull();
    expect(
      await repository.findById(OTHER_ORGANIZATION, theirs.id),
    ).not.toBeNull();
  });

  it('rejects an untenanted row at the database itself, not just in types', async () => {
    // The phase-7 net under everything else in this file. The domain types
    // and the regenerated client already make an organization-less write
    // unrepresentable in TypeScript, so raw SQL is the only way left to
    // attempt one — and the NOT NULL constraint refuses it even there.
    await expect(
      prisma.$executeRaw`
        INSERT INTO tickets
          (id, title, description, status, priority, requester_id,
           created_at, updated_at, organization_id)
        VALUES
          (${randomUUID()}::uuid, 'untenanted', 'must not exist',
           'open'::"TicketStatus", 'low'::"TicketPriority",
           ${randomUUID()}::uuid, now(), now(), NULL)
      `,
    ).rejects.toThrow(/organization_id/);
  });

  it('updates lifecycle fields and appends history', async () => {
    const ticket = aTicket();
    await repository.create(ticket, aHistoryEntry(ticket));

    await repository.update(
      { ...ticket, status: 'in_progress', assigneeId: randomUUID() },
      aHistoryEntry(ticket, { action: 'status_changed' }),
    );

    const found = await repository.findById(TEST_ORGANIZATION, ticket.id);
    expect(found?.status).toBe('in_progress');
    expect(found?.assigneeId).not.toBeNull();
    expect(await repository.historyFor(ticket.id, true)).toHaveLength(2);
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

  it('hides the internal note from history without hiding the public one', async () => {
    // Asserted by identity for the same reason as the comments above: the
    // NOT clause has to exclude exactly the (comment_added, internal) pair.
    // Getting it wrong drops every comment_added entry, or none, and a count
    // of "one fewer than staff sees" cannot tell those two apart.
    const ticket = aTicket();
    await repository.create(ticket, aHistoryEntry(ticket));
    await repository.addComment(
      aComment(ticket, { body: 'public' }),
      aHistoryEntry(ticket, { action: 'comment_added', detail: 'public' }),
    );
    await repository.addComment(
      aComment(ticket, { body: 'internal', internal: true }),
      aHistoryEntry(ticket, { action: 'comment_added', detail: 'internal' }),
    );

    const requesterView = await repository.historyFor(ticket.id, false);
    expect(requesterView.map((h) => [h.action, h.detail])).toEqual([
      ['created', null],
      ['comment_added', 'public'],
    ]);

    const staffView = await repository.historyFor(ticket.id, true);
    expect(staffView.map((h) => h.detail)).toContain('internal');
    expect(staffView).toHaveLength(3);
  });

  it('builds the branch-visibility OR against real SQL: covered branches plus own, never branch C', async () => {
    // The in-memory double proves the rule; this proves the predicate the
    // database actually runs (R2). Same requester planted across branches
    // and organizations so nothing but the OR can be doing the filtering.
    const manager = randomUUID();
    const branchB = randomUUID();
    const branchC = randomUUID();
    const inBranchB = aTicket({ id: randomUUID(), branchId: branchB });
    const inBranchC = aTicket({ id: randomUUID(), branchId: branchC });
    const unrouted = aTicket({ id: randomUUID(), branchId: null });
    const ownElsewhere = aTicket({
      id: randomUUID(),
      branchId: branchC,
      requesterId: manager,
    });
    const foreign = aTicket({
      id: randomUUID(),
      organizationId: OTHER_ORGANIZATION,
      branchId: branchB,
    });
    for (const t of [inBranchB, inBranchC, unrouted, ownElsewhere, foreign]) {
      await repository.create(t, aHistoryEntry(t));
    }

    const page = await repository.list({
      organizationId: TEST_ORGANIZATION,
      branchScope: { branchIds: [branchB], requesterId: manager },
      skip: 0,
      take: 10,
    });

    // Branch B's ticket and the manager's own request routed to branch C —
    // not branch C's other traffic, not the unrouted intake, and never the
    // foreign row even though it sits in branch B's id.
    expect(idsOf(page.items)).toEqual(idsOf([inBranchB, ownElsewhere]));
  });

  it('narrows read_all by branch without an OR-leg', async () => {
    const branchB = randomUUID();
    const routed = aTicket({ id: randomUUID(), branchId: branchB });
    const other = aTicket({ id: randomUUID(), branchId: randomUUID() });
    const unrouted = aTicket({ id: randomUUID(), branchId: null });
    for (const t of [routed, other, unrouted]) {
      await repository.create(t, aHistoryEntry(t));
    }

    const page = await repository.list({
      organizationId: TEST_ORGANIZATION,
      branchId: branchB,
      skip: 0,
      take: 10,
    });
    expect(idsOf(page.items)).toEqual(idsOf([routed]));
  });
});
