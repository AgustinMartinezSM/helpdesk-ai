import { randomUUID } from 'node:crypto';
import type {
  Ticket,
  TicketComment,
  TicketHistoryEntry,
} from '../domain/ticket';

/**
 * One place to build ticket rows for tests.
 *
 * This exists for a specific reason rather than tidiness. Every integration
 * suite in the platform declares its own inline builders, so the tenancy
 * migration would mean adding `organizationId` by hand in every one of them —
 * and missing one produces a test that still passes while proving nothing.
 * With a single factory, the required field lands in one edit and every
 * caller that has not supplied it becomes a compile error.
 *
 * Nothing here is tenant-aware yet. That is the point: when
 * `organizationId` becomes required on `Ticket`, this file is where it goes,
 * and `aTicket()` is where a default belongs so that suites which do not care
 * about tenancy keep working.
 */

export function aTicket(overrides: Partial<Ticket> = {}): Ticket {
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

export function aHistoryEntry(
  ticket: Ticket,
  overrides: Partial<TicketHistoryEntry> = {},
): TicketHistoryEntry {
  return {
    id: randomUUID(),
    ticketId: ticket.id,
    actorId: ticket.requesterId,
    action: 'created',
    detail: null,
    createdAt: new Date(),
    ...overrides,
  };
}

export function aComment(
  ticket: Ticket,
  overrides: Partial<TicketComment> = {},
): TicketComment {
  return {
    id: randomUUID(),
    ticketId: ticket.id,
    authorId: randomUUID(),
    body: 'public reply',
    internal: false,
    createdAt: new Date(),
    ...overrides,
  };
}

/** Sorted ids, so an assertion failure prints what differed rather than a
 * shuffled array. */
export function idsOf(rows: readonly { id: string }[]): string[] {
  return rows.map((row) => row.id).sort();
}
