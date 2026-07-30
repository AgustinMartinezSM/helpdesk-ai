import type {
  SuggestionTask,
  TicketContext,
  TokenUsage,
} from '../../domain/suggestion';

export const AI_PROVIDER = Symbol('AI_PROVIDER');

/**
 * Per-request budget. Passed in rather than read from configuration by the
 * adapter, so every provider is bound by the same limits and none can opt
 * out by forgetting to implement them (ADR 0010).
 */
export interface AiTaskLimits {
  readonly timeoutMs: number;
  readonly maxOutputTokens: number;
}

export interface AiTaskRequest {
  readonly task: SuggestionTask;
  /** Already truncated, with internal notes removed. */
  readonly context: TicketContext;
  readonly limits: AiTaskLimits;
}

export interface AiProviderOutput {
  /**
   * Whatever the provider produced for the task, still untrusted: the use
   * case validates it against the task's schema before anything is stored.
   */
  readonly data: unknown;
  /** The model that actually answered — may differ from the adapter's
   * default when a provider routes or upgrades models. */
  readonly model: string;
  readonly usage: TokenUsage | null;
}

/**
 * The one port a new model provider has to implement.
 *
 * It receives structured context, not a prompt string: the application layer
 * decides WHAT is asked and validates the answer, the adapter decides HOW to
 * ask. That is what lets a deterministic heuristic adapter and an LLM
 * adapter be equally first-class implementations.
 */
export interface AiProvider {
  /** Stable id stored on every suggestion, e.g. 'local'. */
  readonly id: string;
  /** Default model id for this adapter, e.g. 'heuristics-v1'. */
  readonly model: string;
  run(request: AiTaskRequest): Promise<AiProviderOutput>;
}
