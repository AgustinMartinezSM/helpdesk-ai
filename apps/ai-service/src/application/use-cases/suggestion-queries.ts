import { isStaff, type Actor } from '@helpdesk-ai/security';
import { ForbiddenAiActionError } from '../../domain/errors';
import type { Suggestion, SuggestionTask } from '../../domain/suggestion';
import type { SuggestionRepository } from '../ports/suggestion.repository';

/** Hard cap on a history page, so a ticket with hundreds of regenerations
 * cannot turn one request into a large response. */
const MAX_HISTORY = 20;

/**
 * Reads are staff-only for the same reason writes are: a reply draft is
 * written for a technician to review, not for the person waiting on it.
 *
 * There is no per-ticket visibility check here, and that is a deliberate
 * consequence of the ticket domain: staff can view every ticket
 * (`canView` in tickets-service returns true for any staff actor), so
 * "is staff" already implies "could read this ticket". If ticket
 * visibility ever narrows for staff — team-scoped queues, for instance —
 * these queries must start consulting the ticket source too.
 */
export class ListSuggestionsUseCase {
  constructor(private readonly suggestions: SuggestionRepository) {}

  async execute(actor: Actor, ticketId: string): Promise<Suggestion[]> {
    if (!isStaff(actor)) {
      throw new ForbiddenAiActionError();
    }
    return this.suggestions.latestPerTask(ticketId);
  }
}

export class GetSuggestionHistoryUseCase {
  constructor(private readonly suggestions: SuggestionRepository) {}

  async execute(
    actor: Actor,
    ticketId: string,
    task: SuggestionTask,
    limit?: number,
  ): Promise<Suggestion[]> {
    if (!isStaff(actor)) {
      throw new ForbiddenAiActionError();
    }
    const capped = Math.min(Math.max(limit ?? MAX_HISTORY, 1), MAX_HISTORY);
    return this.suggestions.historyFor(ticketId, task, capped);
  }
}
