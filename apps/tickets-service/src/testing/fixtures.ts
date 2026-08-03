import { randomUUID } from 'node:crypto';
import type {
  BranchRef,
  StationRef,
} from '../application/ports/structure-refs.repository';
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

/**
 * The branch matrix (Sprint 9.5). Fixed, obviously synthetic ids for the
 * OTHER_ORGANIZATION reason: an isolation failure should print values a
 * human can tell apart at a glance.
 */
/** A branch of the bootstrap organization; the branch most tests route to. */
export const TEST_BRANCH = '00000000-0000-4000-8000-0000000000b1';
/** A second branch of the SAME organization — the not-my-branch cell. */
export const OTHER_BRANCH = '00000000-0000-4000-8000-0000000000b2';
/** A branch of OTHER_ORGANIZATION — the cross-tenant cells. */
export const FOREIGN_BRANCH = '00000000-0000-4000-8000-0000000000b3';
/** A station under TEST_BRANCH. */
export const TEST_STATION = '00000000-0000-4000-8000-0000000000e1';

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
    // Null by default, like production: a branch is opt-in context, and
    // suites that do not care about routing should say nothing about it.
    branchId: null,
    operationalStationId: null,
    assignedTeamId: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/** A projected branch row; defaults model an active branch of the test org. */
export function aBranchRef(overrides: Partial<BranchRef> = {}): BranchRef {
  return {
    id: TEST_BRANCH,
    organizationId: TEST_ORGANIZATION,
    code: 'BR-12',
    name: 'Store 12',
    status: 'active',
    updatedAt: new Date(),
    ...overrides,
  };
}

/** A projected station row under TEST_BRANCH, active by default. */
export function aStationRef(overrides: Partial<StationRef> = {}): StationRef {
  return {
    id: TEST_STATION,
    branchId: TEST_BRANCH,
    organizationId: TEST_ORGANIZATION,
    code: 'CASH-2',
    name: 'Cashier station 2',
    area: 'checkout',
    status: 'active',
    updatedAt: new Date(),
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
