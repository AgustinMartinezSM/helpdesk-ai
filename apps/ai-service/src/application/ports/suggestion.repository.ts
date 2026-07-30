import type { Suggestion, SuggestionTask } from '../../domain/suggestion';

export const SUGGESTION_REPOSITORY = Symbol('SUGGESTION_REPOSITORY');
export const CLOCK = Symbol('CLOCK');

/**
 * Append-only store. There is no update and no delete: what a model
 * answered is evidence, and evidence that can be rewritten is worth less
 * than none. Regenerating appends; the newest row per (ticket, task) wins.
 */
export interface SuggestionRepository {
  append(suggestion: Suggestion): Promise<void>;
  /** Newest suggestion per task for one ticket, newest first. */
  latestPerTask(ticketId: string): Promise<Suggestion[]>;
  /** Full history for one task, newest first, capped by `limit`. */
  historyFor(
    ticketId: string,
    task: SuggestionTask,
    limit: number,
  ): Promise<Suggestion[]>;
}

/**
 * Time, injected. `monotonicMs` is separate from `now` because provider
 * latency must not be measurable in negative milliseconds when the wall
 * clock is adjusted mid-request.
 */
export interface Clock {
  now(): Date;
  monotonicMs(): number;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  monotonicMs(): number {
    return performance.now();
  }
}
