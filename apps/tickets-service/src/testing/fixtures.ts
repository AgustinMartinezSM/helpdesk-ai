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
 * That happened: `organizationId` is required on all three types now, and it
 * defaults here so suites that do not care about tenancy keep working while
 * suites that do can pass `OTHER_ORGANIZATION` and prove isolation.
 */

/**
 * The bootstrap organization, matching the id the migrations backfill to.
 * Tests that only need *a* tenant should use this default and say nothing
 * about it.
 */
export const TEST_ORGANIZATION = '00000000-0000-4000-8000-000000000001';

/**
 * A second tenant, for the only assertions that matter about isolation: that
 * a query scoped to one organization does not return a row belonging to the
 * other. Deliberately not a random uuid — a fixed, obviously different value
 * makes a failure message readable.
 */
export const OTHER_ORGANIZATION = '00000000-0000-4000-8000-0000000000ff';

export function aTicket(overrides: Partial<Ticket> = {}): Ticket {
  const now = new Date();
  return {
    id: randomUUID(),
    organizationId: TEST_ORGANIZATION,
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
    // Inherited from the ticket, never defaulted separately: a history entry
    // that disagreed with its ticket is precisely what the verification
    // script checks for, so the fixtures must not be able to produce one by
    // accident.
    organizationId: ticket.organizationId,
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
    organizationId: ticket.organizationId,
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
