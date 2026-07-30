import { randomUUID } from 'node:crypto';
import { isStaff, type Actor } from '@helpdesk-ai/security';
import { TRACE_ID_HEADER } from '@helpdesk-ai/observability';
import {
  AiDomainError,
  ForbiddenAiActionError,
  ProviderOutputError,
  ProviderUnavailableError,
} from '../../domain/errors';
import { describeExternalError } from '../../domain/redaction';
import type {
  Suggestion,
  SuggestionTask,
  TicketContext,
} from '../../domain/suggestion';
import { SUGGESTION_OUTPUT_SCHEMAS } from '../../domain/suggestion-outputs';
import { buildTicketContext, hashTicketContext } from '../build-ticket-context';
import type { AiProvider } from '../ports/ai-provider';
import type { EventPublisher } from '../ports/event-publisher';
import type {
  Clock,
  SuggestionRepository,
} from '../ports/suggestion.repository';
import type { CorrelationHeaders, TicketSource } from '../ports/ticket-source';

export interface GenerateSuggestionInput {
  ticketId: string;
  task: SuggestionTask;
  /**
   * The caller's raw access token. Forwarded to tickets-service so
   * authorization is inherited rather than re-implemented (ADR 0011).
   */
  accessToken: string;
  /** Correlation headers of the inbound request, propagated downstream. */
  correlation?: CorrelationHeaders;
}

/**
 * Budget for one provider call. Generous enough for a reasoning model on a
 * long thread, short enough that a hung provider cannot hold an HTTP request
 * open indefinitely.
 */
const PROVIDER_TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 700;

/**
 * Generates one suggestion for one ticket, on request.
 *
 * The shape of this use case is the sprint's central claim: reading the
 * ticket, bounding the context, calling the provider, validating the answer
 * and recording what happened are all steps this layer owns — a provider
 * adapter only answers a question.
 */
export class GenerateSuggestionUseCase {
  constructor(
    private readonly tickets: TicketSource,
    private readonly provider: AiProvider,
    private readonly suggestions: SuggestionRepository,
    private readonly events: EventPublisher,
    private readonly clock: Clock,
  ) {}

  async execute(
    actor: Actor,
    input: GenerateSuggestionInput,
  ): Promise<Suggestion> {
    if (!isStaff(actor)) {
      throw new ForbiddenAiActionError();
    }

    // Throws TicketNotFound / TicketAccessUnauthorized / unavailable — all
    // of them mean "do not call a paid provider", so this comes first.
    const snapshot = await this.tickets.fetch(
      input.ticketId,
      input.accessToken,
      input.correlation,
    );
    const context = buildTicketContext(snapshot);

    const startedAt = this.clock.monotonicMs();
    const answer = await this.ask(input.task, context);
    const latencyMs = Math.max(
      0,
      Math.round(this.clock.monotonicMs() - startedAt),
    );

    const parsed = SUGGESTION_OUTPUT_SCHEMAS[input.task].safeParse(answer.data);
    if (!parsed.success) {
      // Nothing is stored: an off-schema answer is not a fact about a ticket.
      throw new ProviderOutputError(
        this.provider.id,
        input.task,
        parsed.error.issues
          .map(
            (issue) => `${issue.path.join('.') || 'output'}: ${issue.message}`,
          )
          .join('; '),
      );
    }

    const suggestion: Suggestion = {
      id: randomUUID(),
      // The id the ticket store confirmed, not the one the caller typed.
      ticketId: context.ticketId,
      task: input.task,
      output: parsed.data,
      provider: this.provider.id,
      model: answer.model,
      contextHash: hashTicketContext(context),
      usage: answer.usage,
      latencyMs,
      requestedBy: actor.id,
      createdAt: this.clock.now(),
    };

    await this.suggestions.append(suggestion);
    // Best-effort, after the write: the publisher swallows broker failures
    // so a suggestion that exists is never reported as a failure.
    await this.events.publishSuggestionCreated({
      suggestionId: suggestion.id,
      ticketId: suggestion.ticketId,
      task: suggestion.task,
      provider: suggestion.provider,
      model: suggestion.model,
      requestedBy: suggestion.requestedBy,
      createdAt: suggestion.createdAt,
      // Already on the way in, because the ticket read forwards it too — so
      // the suggestion event and the ticket fetch it came from share a trace.
      traceId: input.correlation?.[TRACE_ID_HEADER],
    });

    return suggestion;
  }

  private async ask(task: SuggestionTask, context: TicketContext) {
    try {
      return await this.provider.run({
        task,
        context,
        limits: {
          timeoutMs: PROVIDER_TIMEOUT_MS,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
        },
      });
    } catch (error) {
      // An adapter that already speaks the domain's vocabulary is trusted
      // to have said something more precise than "it failed".
      if (error instanceof AiDomainError) {
        throw error;
      }
      // Anything else came straight from a transport that knows nothing about
      // this domain, so its message, its `cause` chain and any object it threw
      // are untrusted text. `describeExternalError` flattens and redacts them;
      // the error constructor redacts again. Neither is redundant: this one
      // reaches into nested causes the constructor would never see, and that
      // one covers call sites that forget this exists.
      throw new ProviderUnavailableError(
        this.provider.id,
        describeExternalError(error),
      );
    }
  }
}
