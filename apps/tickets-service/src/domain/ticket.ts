import {
  ForbiddenTicketActionError,
  NoOrganizationContextError,
} from './errors';

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
 * Identity claims of the caller, taken from the verified access token.
 *
 * A duplicate of the shared one in `@helpdesk-ai/security`; deleting it is
 * the read-path phase, and it has to go in the same change as the other
 * copies or they drift.
 */
export interface Actor {
  readonly id: string;
  readonly roles: string[];
  /**
   * Tenant the caller is acting in. Optional because the token claim is:
   * resolution fails open, so a token minted during an organizations-service
   * outage carries none, as does one for a user with no membership.
   *
   * Nothing in this domain reads it yet. It exists so an event can say which
   * organization caused it — and note that this is the *caller's* tenant, not
   * the *ticket's*, which is a distinction that stops mattering only when
   * tickets carry their own column.
   */
  readonly organizationId?: string;
}

/**
 * The tenant to write a row under, or a refusal.
 *
 * The only way to turn the actor's optional organization into the required
 * one the domain types ask for. That is deliberate: a write path cannot get a
 * usable value without passing through the refusal, so forgetting the check
 * is a type error rather than a row that belongs to nobody.
 */
export function requireOrganization(actor: Actor): string {
  if (!actor.organizationId) {
    throw new NoOrganizationContextError();
  }
  return actor.organizationId;
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

export function isStaff(actor: Actor): boolean {
  return actor.roles.includes('agent') || actor.roles.includes('admin');
}

/** Requesters see their own tickets; staff see everything. */
export function canView(actor: Actor, ticket: Ticket): boolean {
  return isStaff(actor) || ticket.requesterId === actor.id;
}
