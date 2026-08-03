import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenTicketActionError,
  InvalidTeamContextError,
  TicketNotFoundError,
} from '../../domain/errors';
import type { Ticket } from '../../domain/ticket';
import { randomUUID } from 'node:crypto';
import type { Clock, TicketRepository } from '../ports/ticket.repository';
import type { TeamRefRepository } from '../ports/structure-refs.repository';

export interface RouteTicketInput {
  ticketId: string;
  /** Null clears the routing: the ticket goes back to the central view. */
  teamId: string | null;
}

/**
 * Sends a ticket to the SUPPORT TEAM that should resolve it, or takes it back
 * (Sprint 9.12, ADR 0022).
 *
 * Gated on `routing.manage` — the matrix's routing key, read here as its
 * manual half. Routing changes WHO CAN SEE the ticket, which is why it is a
 * permissioned act rather than an ordinary field edit.
 *
 * The team is validated against the local projection, never by asking
 * organizations-service: creation and routing are hot paths and ADR 0014's
 * mutations-may-ask exception deliberately does not extend to them. One
 * generic refusal covers nonexistent, archived, another organization's and
 * out-of-scope alike — telling them apart would turn this endpoint into an
 * oracle for another tenant's team ids.
 *
 * The branch-scope check is what makes "a branch-local team cannot see
 * unauthorized branches" true of the data rather than of a filter: the ticket
 * is never assigned, so the team never sees it. A ticket with NO branch
 * cannot go to a scoped team at all — there is no branch to prove is in
 * reach.
 */
export class RouteTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly teams: TeamRefRepository,
    private readonly clock: Clock,
  ) {}

  async execute(actor: Actor, input: RouteTicketInput): Promise<Ticket> {
    const organizationId = requireOrganization(actor);

    if (!hasPermission(actor, PERMISSIONS.ROUTING_MANAGE)) {
      throw new ForbiddenTicketActionError();
    }

    const ticket = await this.tickets.findById(organizationId, input.ticketId);
    // Same 404 as a missing ticket, and the tenant is the ONLY scope applied.
    //
    // Deliberately not `canView`: triage is placing work nobody has placed
    // yet, and a service desk manager holds `read_team` — so requiring
    // visibility first would mean they could only route tickets already in
    // their own team, which is exactly the work that does not need routing.
    // The consequence is stated rather than hidden: `routing.manage` reaches
    // every ticket in the organization, and routing one to a team the holder
    // belongs to lets them read it. That is what the key means, and it is why
    // the matrix gives it to owner, organization_admin and
    // service_desk_manager and to nobody else.
    if (!ticket) {
      throw new TicketNotFoundError();
    }

    if (input.teamId !== null) {
      const team = await this.teams.findActive(organizationId, input.teamId);
      // An empty branch set means ORGANIZATION-WIDE, so this reads as "the
      // team reaches everywhere, or it reaches this ticket's branch".
      const covers =
        team !== null &&
        (team.branchIds.length === 0 ||
          (ticket.branchId !== null &&
            team.branchIds.includes(ticket.branchId)));
      if (!covers) {
        throw new InvalidTeamContextError();
      }
    }

    const now = this.clock.now();
    const routed: Ticket = {
      ...ticket,
      assignedTeamId: input.teamId,
      updatedAt: now,
    };

    await this.tickets.update(routed, {
      id: randomUUID(),
      ticketId: ticket.id,
      organizationId: ticket.organizationId,
      actorId: actor.id,
      // Reuses the 'assigned' action rather than inventing a fifth: the
      // history vocabulary is a contract the audit consumers read, and a new
      // word would be a change they have not agreed to. The detail says
      // which kind of assignment it was.
      action: 'assigned',
      detail:
        input.teamId === null
          ? 'unrouted from support team'
          : `routed to support team ${input.teamId}`,
      createdAt: now,
    });

    // No event: the ticket contracts carry no team field, and adding one is
    // a v3 conversation for when a consumer needs it — the standing rule
    // since Sprint 9.5. The history entry is the record.
    return routed;
  }
}
