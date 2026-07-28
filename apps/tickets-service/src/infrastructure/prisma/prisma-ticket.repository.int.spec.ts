import { randomUUID } from 'node:crypto';
import type { Ticket } from '../../domain/ticket';
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

  function buildTicket(overrides: Partial<Ticket> = {}): Ticket {
    const now = new Date();
    return {
      id: randomUUID(),
      title: 'Integration ticket',
      description: 'Persisted for real',
      status: 'open',
      priority: 'high',
      category: 'hardware',
      requesterId: randomUUID(),
      assigneeId: null,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    };
  }

  function historyFor(ticket: Ticket, action: 'created' | 'status_changed') {
    return {
      id: randomUUID(),
      ticketId: ticket.id,
      actorId: ticket.requesterId,
      action,
      detail: null,
      createdAt: new Date(),
    };
  }

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
    const ticket = buildTicket();
    await repository.create(ticket, historyFor(ticket, 'created'));

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

  it('lists with filters, pagination and total count', async () => {
    const requester = randomUUID();
    for (let i = 0; i < 3; i += 1) {
      const ticket = buildTicket({
        requesterId: requester,
        status: i === 0 ? 'closed' : 'open',
      });
      await repository.create(ticket, historyFor(ticket, 'created'));
    }
    const foreign = buildTicket();
    await repository.create(foreign, historyFor(foreign, 'created'));

    const own = await repository.list({
      requesterId: requester,
      skip: 0,
      take: 10,
    });
    expect(own.total).toBe(3);

    const openOnly = await repository.list({
      requesterId: requester,
      status: 'open',
      skip: 0,
      take: 1,
    });
    expect(openOnly.total).toBe(2);
    expect(openOnly.items).toHaveLength(1);
  });

  it('updates lifecycle fields and appends history', async () => {
    const ticket = buildTicket();
    await repository.create(ticket, historyFor(ticket, 'created'));

    await repository.update(
      { ...ticket, status: 'in_progress', assigneeId: randomUUID() },
      historyFor(ticket, 'status_changed'),
    );

    const found = await repository.findById(ticket.id);
    expect(found?.status).toBe('in_progress');
    expect(found?.assigneeId).not.toBeNull();
    expect(await repository.historyFor(ticket.id)).toHaveLength(2);
  });

  it('separates internal and public comments', async () => {
    const ticket = buildTicket();
    await repository.create(ticket, historyFor(ticket, 'created'));

    await repository.addComment(
      {
        id: randomUUID(),
        ticketId: ticket.id,
        authorId: randomUUID(),
        body: 'public',
        internal: false,
        createdAt: new Date(),
      },
      { ...historyFor(ticket, 'created'), action: 'comment_added' },
    );
    await repository.addComment(
      {
        id: randomUUID(),
        ticketId: ticket.id,
        authorId: randomUUID(),
        body: 'internal',
        internal: true,
        createdAt: new Date(),
      },
      { ...historyFor(ticket, 'created'), action: 'comment_added' },
    );

    expect(await repository.commentsFor(ticket.id, false)).toHaveLength(1);
    expect(await repository.commentsFor(ticket.id, true)).toHaveLength(2);
  });
});
