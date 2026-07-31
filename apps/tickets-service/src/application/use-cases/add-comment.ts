import { randomUUID } from 'node:crypto';
import {
  hasPermission,
  PERMISSIONS,
  requireOrganization,
  type Actor,
} from '@helpdesk-ai/security';
import {
  ForbiddenTicketActionError,
  TicketNotFoundError,
} from '../../domain/errors';
import {
  canView,
  requireOrganizationOf,
  type TicketComment,
} from '../../domain/ticket';
import type { EventPublisher } from '../ports/event-publisher';
import type { Clock, TicketRepository } from '../ports/ticket.repository';

export interface AddCommentInput {
  body: string;
  internal?: boolean;
}

export class AddCommentUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  async execute(
    actor: Actor,
    ticketId: string,
    input: AddCommentInput,
    traceId?: string,
  ): Promise<TicketComment> {
    const ticket = await this.tickets.findById(
      requireOrganization(actor),
      ticketId,
    );
    if (!ticket || !canView(actor, ticket)) {
      throw new TicketNotFoundError();
    }

    const internal = input.internal ?? false;
    // Internal notes are the internal staff workspace; whoever lacks the
    // grant can never write (or read) them.
    if (internal && !hasPermission(actor, PERMISSIONS.TICKETS_NOTE_INTERNAL)) {
      throw new ForbiddenTicketActionError();
    }

    const organizationId = requireOrganizationOf(actor, ticket);
    const now = this.clock.now();
    const comment: TicketComment = {
      id: randomUUID(),
      ticketId,
      organizationId,
      authorId: actor.id,
      body: input.body,
      internal,
      createdAt: now,
    };

    await this.tickets.addComment(comment, {
      id: randomUUID(),
      ticketId,
      organizationId,
      actorId: actor.id,
      action: 'comment_added',
      detail: internal ? 'internal' : 'public',
      createdAt: now,
    });

    await this.events.publishTicketCommentAdded({
      ticketId,
      commentId: comment.id,
      authorId: actor.id,
      internal,
      addedAt: now,
      traceId,
      organizationId,
    });

    return comment;
  }
}
