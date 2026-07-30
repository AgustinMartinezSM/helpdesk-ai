import type { SuggestionOutput } from './suggestion-outputs';

/**
 * The AI domain, in one sentence: a suggestion is a recorded answer from a
 * model about a ticket, and it is advice — never an action.
 *
 * Nothing in this service can change a ticket. There is no client, no port
 * and no credential here that writes to tickets-service, so "AI assists,
 * people decide" is a structural property of the platform rather than a
 * policy someone has to remember.
 */

export const SUGGESTION_TASKS = [
  'summary',
  'classification',
  'priority',
  'reply',
] as const;
export type SuggestionTask = (typeof SUGGESTION_TASKS)[number];

/**
 * Closed vocabulary for classification.
 *
 * It lives here rather than in tickets-service because tickets currently
 * store a free-text, nullable `category`: this service needs a fixed set to
 * validate a provider's answer against, and it must not invent a constraint
 * on another service's column. Adopting this vocabulary into the ticket
 * domain (so a suggestion can pre-fill the field) is deliberate future work.
 */
export const SUGGESTION_CATEGORIES = [
  'access',
  'hardware',
  'software',
  'network',
  'billing',
  'other',
] as const;
export type SuggestionCategory = (typeof SUGGESTION_CATEGORIES)[number];

/** Mirrored from `apps/tickets-service/src/domain/ticket.ts`: a priority
 * suggestion has to speak the vocabulary the ticket domain actually accepts,
 * or the technician is offered a value they cannot apply. */
export const TICKET_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];

export const TICKET_STATUSES = [
  'open',
  'in_progress',
  'resolved',
  'closed',
] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** One message of the public thread, as the provider will see it. */
export interface TicketContextMessage {
  readonly authorRole: 'requester' | 'staff';
  readonly body: string;
  readonly at: string;
}

/**
 * Everything a provider is allowed to know about a ticket.
 *
 * Built by the application layer (`build-ticket-context.ts`), which
 * truncates it and drops internal notes before it exists. Internal notes
 * are readable by this service — it calls tickets-service as a staff user —
 * so excluding them is an explicit act, done once, in one place.
 */
export interface TicketContext {
  readonly ticketId: string;
  readonly title: string;
  readonly description: string;
  readonly status: TicketStatus;
  readonly currentPriority: TicketPriority;
  readonly currentCategory: string | null;
  readonly messages: readonly TicketContextMessage[];
  /** True when the thread was cut to fit the limits, so prompts can say so. */
  readonly truncated: boolean;
}

/** Token accounting as reported by the provider, when it reports any. */
export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * A stored suggestion. Immutable by construction: regenerating appends a
 * new record, and the newest one per (ticket, task) is the current answer.
 */
export interface Suggestion {
  readonly id: string;
  /**
   * Tenant this suggestion belongs to (ADR 0012). Required: a suggestion is
   * a record of spend and of what a model was shown, and one that belongs to
   * no organization cannot be attributed to anybody.
   */
  readonly organizationId: string;
  readonly ticketId: string;
  readonly task: SuggestionTask;
  readonly output: SuggestionOutput;
  readonly provider: string;
  readonly model: string;
  readonly contextHash: string;
  readonly usage: TokenUsage | null;
  readonly latencyMs: number;
  readonly requestedBy: string;
  readonly createdAt: Date;
}

export function isSuggestionTask(value: string): value is SuggestionTask {
  return (SUGGESTION_TASKS as readonly string[]).includes(value);
}

// Callers read a suggestion and the shape of its output from this one module,
// so these re-exports are load-bearing rather than convenience — the HTTP
// controller imports SuggestionOutput from here. Nothing but `tsc` notices if
// they disappear: swc strips types without checking them and webpack only
// walks the entry graph, which is how a missing one survived lint, test and
// build until `pnpm typecheck` joined the gate.
export type {
  ClassificationOutput,
  PriorityOutput,
  ReplyOutput,
  SuggestionOutput,
  SummaryOutput,
} from './suggestion-outputs';
