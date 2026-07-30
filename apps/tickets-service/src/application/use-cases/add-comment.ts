import { randomUUID } from 'node:crypto';
import {
  ForbiddenTicketActionError,
  TicketNotFoundError,
} from '../../domain/errors';
import {
  canView,
  isStaff,
  requireOrganization,
  requireOrganizationOf,
  type Actor,
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
    // Internal notes are a staff tool; requesters can never write (or read)
    // them.
    if (internal && !isStaff(actor)) {
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
