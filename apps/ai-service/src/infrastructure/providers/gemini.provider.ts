import type {
  AiProvider,
  AiProviderOutput,
  AiTaskRequest,
} from '../../application/ports/ai-provider';
import {
  ProviderOutputError,
  ProviderUnavailableError,
} from '../../domain/errors';
import { describeExternalError, redactSecrets } from '../../domain/redaction';
import {
  SUGGESTION_CATEGORIES,
  TICKET_PRIORITIES,
  type SuggestionTask,
  type TicketContext,
} from '../../domain/suggestion';
import { OUTPUT_LIMITS } from '../../domain/suggestion-outputs';

/**
 * Google Gemini adapter for the AiProvider port.
 *
 * Built against the Interactions API (checked 2026-07-30):
 *
 *   https://ai.google.dev/gemini-api/docs/quickstart
 *   https://ai.google.dev/gemini-api/docs/structured-output
 *   https://ai.google.dev/api/interactions-api
 *
 * The older `{model}:generateContent` surface would also work. Interactions
 * was chosen because its `response_format.schema` takes standard JSON Schema
 * (`required`, `enum`, `anyOf`), which maps directly onto this service's
 * per-task output schemas, while generateContent's `responseSchema` accepts
 * only an OpenAPI subset.
 *
 * No SDK: one HTTP call needs no dependency, and what this class has to
 * satisfy is the port's contract, not a vendor client's ergonomics.
 *
 * Rules this class must not break:
 *
 * - **The key travels in a header, never in the URL.** Query strings end up
 *   in proxy logs and error reports; `x-goog-api-key` does not.
 * - **The key never reaches a message, log or thrown error.** Every error
 *   detail derived from the transport or from the upstream body goes
 *   through `redact` first; the rest are fixed literals. `AiDomainError`
 *   redacts again on construction, so forgetting here degrades the result
 *   rather than leaking — the exact-value layer is what only this class can
 *   contribute (`domain/redaction.ts`). The success path is deliberately
 *   not redacted: the answer and the model name are the values this class
 *   exists to return, and the key is never in the prompt or request body
 *   for an upstream to echo back.
 * - **One attempt per call.** A retry doubles the spend and the latency of a
 *   request someone is waiting on, and retry policy is a platform-wide
 *   decision rather than this adapter's to make.
 *
 * Structured output is requested, not assumed: the schema is sent with the
 * request, and the application layer validates the answer against the domain
 * schema regardless of what comes back (ADR 0010).
 */

const DEFAULT_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/interactions';

/**
 * Shared instruction. "Use only what the ticket says" is the important line:
 * a plausible invention is worse than an unhelpful answer when a technician
 * is about to act on it.
 */
const SYSTEM_INSTRUCTION = [
  'You assist a human support technician. You never act; you only propose.',
  'Rules:',
  '- Use only what the ticket says. Never invent facts, names, dates, causes or fixes that are not in the text.',
  '- If the ticket is too vague to answer well, say so in the fields you are given instead of guessing.',
  '- Write in the same language the ticket is written in.',
  '- Answer with JSON only, matching the given schema exactly. No prose outside it.',
].join('\n');

const TASK_INSTRUCTIONS: Record<SuggestionTask, string> = {
  summary: [
    'Task: summarize this ticket for a technician who has not read it yet.',
    `- "text": at most ${OUTPUT_LIMITS.summaryText} characters, factual, no greeting, no advice.`,
    `- "bullets": up to ${OUTPUT_LIMITS.bullets} short lines (max ${OUTPUT_LIMITS.bullet} characters each) with the facts that matter for triage. Use an empty array if the text says it all.`,
  ].join('\n'),
  classification: [
    'Task: choose the one category that best fits this request.',
    `- "category": exactly one of ${SUGGESTION_CATEGORIES.join(', ')}. Use "other" when none fits.`,
    '- "confidence": your own certainty, 0 to 1.',
    `- "rationale": at most ${OUTPUT_LIMITS.rationale} characters naming the words in the ticket that led you there.`,
  ].join('\n'),
  priority: [
    'Task: estimate how urgent this request is.',
    `- "priority": exactly one of ${TICKET_PRIORITIES.join(', ')}.`,
    '- Judge from impact and blocking, not from tone. Say the current priority again if the text gives no reason to change it.',
    '- "confidence": your own certainty, 0 to 1.',
    `- "rationale": at most ${OUTPUT_LIMITS.rationale} characters.`,
  ].join('\n'),
  reply: [
    'Task: draft a first reply that the technician will review, edit and send as themselves.',
    `- "body": at most ${OUTPUT_LIMITS.replyBody} characters. Plain text, no signature, no placeholders like [name].`,
    '- Do not promise a timeline, a cause or a fix you cannot know from the ticket. Do not claim the problem is solved.',
    `- "followUpQuestion": at most ${OUTPUT_LIMITS.followUpQuestion} characters — the one question that would unblock this ticket — or null when the thread already contains what is needed.`,
  ].join('\n'),
};

/**
 * Response schemas in standard JSON Schema, using only the keywords the
 * structured-output guide lists as supported. String length limits are NOT
 * expressed here (the guide lists no minLength/maxLength support): the prompt
 * states them and the domain schema enforces them.
 */
const RESPONSE_SCHEMAS: Record<SuggestionTask, unknown> = {
  summary: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Factual summary for a technician' },
      bullets: {
        type: 'array',
        items: { type: 'string' },
        maxItems: OUTPUT_LIMITS.bullets,
      },
    },
    required: ['text', 'bullets'],
    additionalProperties: false,
  },
  classification: {
    type: 'object',
    properties: {
      category: { type: 'string', enum: [...SUGGESTION_CATEGORIES] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string' },
    },
    required: ['category', 'confidence', 'rationale'],
    additionalProperties: false,
  },
  priority: {
    type: 'object',
    properties: {
      priority: { type: 'string', enum: [...TICKET_PRIORITIES] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      rationale: { type: 'string' },
    },
    required: ['priority', 'confidence', 'rationale'],
    additionalProperties: false,
  },
  reply: {
    type: 'object',
    properties: {
      body: { type: 'string' },
      followUpQuestion: {
        anyOf: [{ type: 'string' }, { type: 'null' }],
      },
    },
    required: ['body', 'followUpQuestion'],
    additionalProperties: false,
  },
};

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  /** Overridable for tests; production always uses the documented endpoint. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

interface InteractionResponse {
  steps?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  usage?: {
    total_input_tokens?: unknown;
    total_output_tokens?: unknown;
  };
  model?: string;
}

export class GeminiProvider implements AiProvider {
  readonly id = 'gemini';
  readonly model: string;

  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GeminiProviderOptions) {
    this.model = options.model;
    this.apiKey = options.apiKey;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async run(request: AiTaskRequest): Promise<AiProviderOutput> {
    const { task, context, limits } = request;

    const body = {
      model: this.model,
      system_instruction: SYSTEM_INSTRUCTION,
      input: `${TASK_INSTRUCTIONS[task]}\n\n${renderTicket(context)}`,
      generation_config: { max_output_tokens: limits.maxOutputTokens },
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema: RESPONSE_SCHEMAS[task],
      },
    };

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        // Undici strips `authorization` on a cross-origin redirect but not a
        // custom header, so following one would hand `x-goog-api-key` to
        // whatever host the redirect names. Nothing legitimate redirects here.
        redirect: 'error',
        signal: AbortSignal.timeout(limits.timeoutMs),
      });
    } catch (error) {
      // A transport failure is where the request comes back at you: undici
      // puts the interesting part in `cause`, and an echoed request carries
      // the header that holds the key.
      throw new ProviderUnavailableError(
        this.id,
        this.redact(describeExternalError(error)),
      );
    }

    if (!response.ok) {
      throw new ProviderUnavailableError(
        this.id,
        this.redact(await describeFailure(response)),
      );
    }

    let payload: InteractionResponse;
    try {
      payload = (await response.json()) as InteractionResponse;
    } catch {
      throw new ProviderUnavailableError(
        this.id,
        'the response body was not JSON',
      );
    }

    const text = extractText(payload);
    if (text === null) {
      // A response with no text step is not a malformed answer to parse —
      // it is the model declining or being cut off, which is an availability
      // problem for the caller, not a schema problem.
      throw new ProviderUnavailableError(
        this.id,
        'the response contained no model output',
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ProviderOutputError(
        this.id,
        task,
        'the answer was not valid JSON despite the requested response format',
      );
    }

    return {
      data,
      // The response names the model that actually served the request, which
      // may differ from the alias asked for; record what answered.
      model: typeof payload.model === 'string' ? payload.model : this.model,
      usage: readUsage(payload),
    };
  }

  /**
   * Exact-value redaction, which only this class can do: it is the one place
   * that holds the key. The shared rules run too, so a credential that is
   * shaped like one but is not ours — an echoed `authorization` header, a
   * second provider's token — is caught here as well.
   */
  private redact(detail: string): string {
    return redactSecrets(detail, [this.apiKey]);
  }
}

function renderTicket(context: TicketContext): string {
  const lines = [
    'Ticket:',
    `- Title: ${context.title}`,
    `- Status: ${context.status.replace('_', ' ')}`,
    `- Current priority: ${context.currentPriority}`,
    `- Current category: ${context.currentCategory ?? 'none'}`,
    '',
    'Description:',
    context.description.length > 0 ? context.description : '(empty)',
    '',
  ];

  if (context.messages.length === 0) {
    lines.push('Thread: no replies yet.');
  } else {
    lines.push('Thread, oldest first:');
    for (const message of context.messages) {
      lines.push(`- [${message.authorRole}] ${message.body}`);
    }
  }

  if (context.truncated) {
    // Told, not hidden: a model that believes it sees the whole ticket will
    // summarize a partial one with full confidence.
    lines.push(
      '',
      'Note: this ticket was shortened to fit a size limit, so you are seeing only the most recent part of it.',
    );
  }

  // Internal notes never reach here — they are removed while the context is
  // built (ADR 0011).
  return lines.join('\n');
}

function extractText(payload: InteractionResponse): string | null {
  const steps = Array.isArray(payload.steps) ? payload.steps : [];
  for (const step of steps) {
    if (step?.type !== 'model_output' || !Array.isArray(step.content)) {
      continue;
    }
    for (const block of step.content) {
      if (block?.type === 'text' && typeof block.text === 'string') {
        const text = block.text.trim();
        if (text.length > 0) {
          return text;
        }
      }
    }
  }
  return null;
}

function readUsage(
  payload: InteractionResponse,
): { inputTokens: number; outputTokens: number } | null {
  const input = payload.usage?.total_input_tokens;
  const output = payload.usage?.total_output_tokens;
  const usable = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0;
  // Reported as null rather than zero when absent: zero spend and unknown
  // spend are different facts, and this number feeds cost reporting.
  return usable(input) && usable(output)
    ? { inputTokens: input, outputTokens: output }
    : null;
}

/** Turns a failed HTTP response into one short line, body included when the
 * provider explains itself. */
async function describeFailure(response: Response): Promise<string> {
  let hint = '';
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (typeof body?.error?.message === 'string') {
      hint = `: ${body.error.message}`;
    }
  } catch {
    // No body, or not JSON — the status alone is the answer.
  }
  const rateLimited =
    response.status === 429 ? ' (rate limited or out of quota)' : '';
  return `HTTP ${response.status}${rateLimited}${hint}`;
}

/** Exported for the spec that keeps these schemas honest against the domain. */
export const GEMINI_RESPONSE_SCHEMAS = RESPONSE_SCHEMAS;
export const GEMINI_ENDPOINT = DEFAULT_ENDPOINT;
