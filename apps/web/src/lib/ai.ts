/**
 * Browser-side client for the BFF's AI endpoints.
 *
 * Mirrors lib/tickets.ts: every call carries the in-memory access token, and
 * a 401 signals the caller to refresh or re-login. The four task shapes are
 * mirrored from ai-service's output schemas — the server validates them, so
 * these types describe what the UI can rely on rather than re-checking it.
 */

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL ?? 'http://localhost:3001';

export const SUGGESTION_TASKS = [
  'summary',
  'classification',
  'priority',
  'reply',
] as const;
export type SuggestionTask = (typeof SUGGESTION_TASKS)[number];

export interface SummaryOutput {
  text: string;
  bullets: string[];
}

export interface ClassificationOutput {
  category: string;
  confidence: number;
  rationale: string;
}

export interface PriorityOutput {
  priority: string;
  confidence: number;
  rationale: string;
}

export interface ReplyOutput {
  body: string;
  followUpQuestion: string | null;
}

export type SuggestionOutput =
  SummaryOutput | ClassificationOutput | PriorityOutput | ReplyOutput;

export interface Suggestion {
  id: string;
  ticketId: string;
  task: SuggestionTask;
  output: SuggestionOutput;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  latencyMs: number;
  contextHash: string;
  requestedBy: string;
  createdAt: string;
}

export interface AiProviderInfo {
  id: string;
  model: string;
}

export class AiApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AiApiError';
  }
}

async function call<T>(
  accessToken: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${BFF_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let message = 'Something went wrong';
    try {
      const parsed = (await response.json()) as { message?: string | string[] };
      message = Array.isArray(parsed.message)
        ? parsed.message.join(', ')
        : (parsed.message ?? message);
    } catch {
      // keep the generic message
    }
    throw new AiApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export function getAiProvider(accessToken: string): Promise<AiProviderInfo> {
  return call(accessToken, 'GET', '/ai/provider');
}

export function listSuggestions(
  accessToken: string,
  ticketId: string,
): Promise<Suggestion[]> {
  return call(
    accessToken,
    'GET',
    `/ai/tickets/${encodeURIComponent(ticketId)}/suggestions`,
  );
}

export function generateSuggestion(
  accessToken: string,
  ticketId: string,
  task: SuggestionTask,
): Promise<Suggestion> {
  return call(
    accessToken,
    'POST',
    `/ai/tickets/${encodeURIComponent(ticketId)}/suggestions`,
    { task },
  );
}
