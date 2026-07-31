import { hasPermission, PERMISSIONS, type Actor } from '@helpdesk-ai/security';
import { ForbiddenAiActionError } from '../../domain/errors';
import type { Suggestion, SuggestionTask } from '../../domain/suggestion';
import type { SuggestionRepository } from '../ports/suggestion.repository';

/** Hard cap on a history page, so a ticket with hundreds of regenerations
 * cannot turn one request into a large response. */
const MAX_HISTORY = 20;

/**
 * Reads are gated by tickets.note_internal for the same reason writes are:
 * the AI tools are part of the internal staff workspace, and their output
 * derives from conversation context a requester cannot see.
 *
 * There is no per-ticket visibility check here, and that is a deliberate
 * consequence of the ticket domain: the same templates that grant
 * note_internal grant the org-wide ticket read, so holding this key already
 * implies "could read this ticket". If ticket visibility ever narrows for
 * staff — team-scoped queues, for instance — these queries must start
 * consulting the ticket source too.
 */
export class ListSuggestionsUseCase {
  constructor(private readonly suggestions: SuggestionRepository) {}

  async execute(actor: Actor, ticketId: string): Promise<Suggestion[]> {
    if (!hasPermission(actor, PERMISSIONS.TICKETS_NOTE_INTERNAL)) {
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
    if (!hasPermission(actor, PERMISSIONS.TICKETS_NOTE_INTERNAL)) {
      throw new ForbiddenAiActionError();
    }
    const capped = Math.min(Math.max(limit ?? MAX_HISTORY, 1), MAX_HISTORY);
    return this.suggestions.historyFor(ticketId, task, capped);
  }
}
