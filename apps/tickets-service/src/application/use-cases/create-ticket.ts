import { randomUUID } from 'node:crypto';
import type { Actor, Ticket, TicketPriority } from '../../domain/ticket';
import type { EventPublisher } from '../ports/event-publisher';
import type { Clock, TicketRepository } from '../ports/ticket.repository';

export interface CreateTicketInput {
  title: string;
  description: string;
  priority?: TicketPriority;
  category?: string;
}

export class CreateTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly clock: Clock,
    private readonly events: EventPublisher,
  ) {}

  async execute(actor: Actor, input: CreateTicketInput): Promise<Ticket> {
    const now = this.clock.now();
    const ticket: Ticket = {
      id: randomUUID(),
      title: input.title,
      description: input.description,
      status: 'open',
      priority: input.priority ?? 'medium',
      category: input.category ?? null,
      requesterId: actor.id,
      assigneeId: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.tickets.create(ticket, {
      id: randomUUID(),
      ticketId: ticket.id,
      actorId: actor.id,
      action: 'created',
      detail: null,
      createdAt: now,
    });

    await this.events.publishTicketCreated({
      ticketId: ticket.id,
      requesterId: ticket.requesterId,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
      createdAt: now,
    });

    return ticket;
  }
}
