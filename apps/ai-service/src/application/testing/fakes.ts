import type { Suggestion, SuggestionTask } from '../../domain/suggestion';
import type { AiProvider, AiTaskRequest } from '../ports/ai-provider';
import type {
  EventPublisher,
  SuggestionCreatedEvent,
} from '../ports/event-publisher';
import type {
  Clock,
  SuggestionRepository,
} from '../ports/suggestion.repository';
import type {
  CorrelationHeaders,
  SourceTicketSnapshot,
  TicketSource,
} from '../ports/ticket-source';

/**
 * In-memory doubles for the application ports. They enforce the same
 * invariants as the real adapters — append-only storage, newest-first
 * ordering — so a use-case spec that passes here is not passing because the
 * double was permissive.
 */

export class FakeSuggestionRepository implements SuggestionRepository {
  readonly rows: Suggestion[] = [];

  async append(suggestion: Suggestion): Promise<void> {
    this.rows.push(suggestion);
  }

  async latestPerTask(ticketId: string): Promise<Suggestion[]> {
    const seen = new Set<SuggestionTask>();
    return this.newestFirst((row) => row.ticketId === ticketId).filter(
      (row) => {
        if (seen.has(row.task)) {
          return false;
        }
        seen.add(row.task);
        return true;
      },
    );
  }

  async historyFor(
    ticketId: string,
    task: SuggestionTask,
    limit: number,
  ): Promise<Suggestion[]> {
    return this.newestFirst(
      (row) => row.ticketId === ticketId && row.task === task,
    ).slice(0, limit);
  }

  /**
   * Newest first, with insertion order breaking ties. A fixed clock in a
   * spec produces identical timestamps, and "whichever the sort happened to
   * put first" is not an ordering — appended later means newer here, exactly
   * as an autoincrementing arrival order would behave.
   */
  private newestFirst(match: (row: Suggestion) => boolean): Suggestion[] {
    return this.rows
      .map((row, index) => ({ row, index }))
      .filter((entry) => match(entry.row))
      .sort(
        (a, b) =>
          b.row.createdAt.getTime() - a.row.createdAt.getTime() ||
          b.index - a.index,
      )
      .map((entry) => entry.row);
  }
}

export class FakeTicketSource implements TicketSource {
  readonly calls: Array<{
    ticketId: string;
    accessToken: string;
    correlation?: CorrelationHeaders;
  }> = [];
  failure: Error | null = null;

  constructor(private snapshot: SourceTicketSnapshot) {}

  async fetch(
    ticketId: string,
    accessToken: string,
    correlation?: CorrelationHeaders,
  ): Promise<SourceTicketSnapshot> {
    this.calls.push({ ticketId, accessToken, correlation });
    if (this.failure) {
      throw this.failure;
    }
    return this.snapshot;
  }

  replaceSnapshot(snapshot: SourceTicketSnapshot): void {
    this.snapshot = snapshot;
  }
}

/** Records what it was asked and answers whatever the spec scripted. */
export class ScriptedAiProvider implements AiProvider {
  readonly id = 'scripted';
  readonly model = 'scripted-v1';
  readonly requests: AiTaskRequest[] = [];
  failure: Error | null = null;

  constructor(
    private answers: Partial<Record<SuggestionTask, unknown>> = {},
    private readonly usage: {
      inputTokens: number;
      outputTokens: number;
    } | null = {
      inputTokens: 120,
      outputTokens: 40,
    },
  ) {}

  async run(request: AiTaskRequest) {
    this.requests.push(request);
    if (this.failure) {
      throw this.failure;
    }
    return {
      data: this.answers[request.task],
      model: this.model,
      usage: this.usage,
    };
  }

  answerWith(answers: Partial<Record<SuggestionTask, unknown>>): void {
    this.answers = answers;
  }
}

export class RecordingEventPublisher implements EventPublisher {
  readonly published: SuggestionCreatedEvent[] = [];

  async publishSuggestionCreated(event: SuggestionCreatedEvent): Promise<void> {
    this.published.push(event);
  }
}

/**
 * Wall clock fixed, monotonic clock scripted: latency assertions need a
 * controllable elapsed time, and a fixed date keeps stored rows comparable.
 */
export class FakeClock implements Clock {
  private monotonic = 0;

  constructor(
    private readonly fixed: Date = new Date('2026-07-29T10:00:00.000Z'),
    private readonly step = 250,
  ) {}

  now(): Date {
    return this.fixed;
  }

  monotonicMs(): number {
    const current = this.monotonic;
    this.monotonic += this.step;
    return current;
  }
}
