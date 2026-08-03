import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import { ForbiddenTicketActionError } from './errors';

export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

/**
 * Legal lifecycle moves. Anything not listed is rejected — closed tickets
 * are terminal, resolution can be reopened, and closing is possible from
 * open (mistaken tickets) or resolved (confirmed fixes).
 */
const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['in_progress', 'closed'],
  in_progress: ['resolved', 'open'],
  resolved: ['closed', 'open'],
  closed: [],
};

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export interface Ticket {
  readonly id: string;
  /**
   * Tenant this ticket belongs to (ADR 0012). Required: a ticket belonging to
   * no organization is not something this platform can decide anything about,
   * so the write paths refuse rather than storing one.
   *
   * An opaque identifier — organizations live in another service's database
   * (ADR 0003), so nothing here can validate it beyond its shape.
   */
  readonly organizationId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TicketStatus;
  readonly priority: TicketPriority;
  readonly category: string | null;
  /** User id issued by auth-service; a plain identifier, never a foreign key. */
  readonly requesterId: string;
  readonly assigneeId: string | null;
  /**
   * Branch this ticket was filed under (ADR 0016) — an opaque id validated
   * against the local projection at creation. Null is a permanently
   * legitimate state, not a migration gap: the eight-person shop never
   * configures a branch and its tickets carry none, forever.
   */
  readonly branchId: string | null;
  /**
   * Station the request came from. Context, never a principal (ADR 0016):
   * this names a place, and requesterId keeps naming the person. Advisory
   * until device registration exists — nothing verifies provenance yet.
   */
  readonly operationalStationId: string | null;
  /**
   * The SUPPORT TEAM that owns resolving this ticket (Sprint 9.12,
   * ADR 0022): the operational group, never the requester's department.
   * Null forever is legitimate — a ticket nobody has routed is a normal
   * state, and unrouted intake stays with the organization-wide readers.
   */
  readonly assignedTeamId: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TicketComment {
  readonly id: string;
  readonly ticketId: string;
  /** Denormalized from the ticket, so a scoped read needs no join. */
  readonly organizationId: string;
  readonly authorId: string;
  readonly body: string;
  /** Internal notes are visible to staff only, never to the requester. */
  readonly internal: boolean;
  readonly createdAt: Date;
}

export type TicketAction =
  'created' | 'status_changed' | 'assigned' | 'comment_added';

export interface TicketHistoryEntry {
  readonly id: string;
  readonly ticketId: string;
  /** Denormalized from the ticket, so a scoped read needs no join. */
  readonly organizationId: string;
  readonly actorId: string;
  readonly action: TicketAction;
  readonly detail: string | null;
  readonly createdAt: Date;
}

/**
 * The tenant to write a child row under, having confirmed the caller is
 * acting inside the ticket's organization and not merely able to see it.
 *
 * This is the distinction the event contracts could not make yet: a ticket
 * event carried the *caller's* organization because the ticket had none.
 * Now it has one, so a mutation can insist they are the same, and the row
 * takes the ticket's — a comment belongs to its ticket's tenant regardless of
 * who wrote it.
 *
 * Nothing can reach this across organizations today, because a caller only
 * gets a ticket back if the read let them have it. That is exactly why the
 * check belongs here as well: it does not depend on the read staying correct.
 */
export function requireOrganizationOf(actor: Actor, ticket: Ticket): string {
  if (requireOrganization(actor) !== ticket.organizationId) {
    throw new ForbiddenTicketActionError();
  }
  return ticket.organizationId;
}

/**
 * Requesters see their own tickets; the org-wide read sees every ticket in
 * the organization; the branch read sees tickets ROUTED to a branch the
 * actor's membership covers. Callers that fail this get the not-found
 * answer, never a 403 — confirming the ticket exists is the leak.
 *
 * The team read sees tickets ASSIGNED to a support team the actor actively
 * belongs to (Sprint 9.12, ADR 0022) — the group that resolves it, never the
 * requester's department, which grants nothing here.
 *
 * A branchless ticket is deliberately invisible to the branch read, and an
 * unrouted one to the team read: intake nobody has placed belongs to the
 * central view — read_all holders and the requester see it, a branch or team
 * manager does not. And an absent set DENIES rather than grants, for both
 * scopes: an old token loses visibility, never gains it.
 */
export function canView(actor: Actor, ticket: Ticket): boolean {
  return (
    hasPermission(actor, PERMISSIONS.TICKETS_READ_ALL) ||
    (hasPermission(actor, PERMISSIONS.TICKETS_READ_BRANCH) &&
      ticket.branchId !== null &&
      (actor.branchIds?.has(ticket.branchId) ?? false)) ||
    (hasPermission(actor, PERMISSIONS.TICKETS_READ_TEAM) &&
      ticket.assignedTeamId !== null &&
      (actor.teamIds?.has(ticket.assignedTeamId) ?? false)) ||
    ticket.requesterId === actor.id
  );
}
