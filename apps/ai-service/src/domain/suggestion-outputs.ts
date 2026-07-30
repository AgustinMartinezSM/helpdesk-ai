import { z } from '@helpdesk-ai/configuration';
import {
  SUGGESTION_CATEGORIES,
  SUGGESTION_TASKS,
  TICKET_PRIORITIES,
  type SuggestionTask,
} from './suggestion';

/**
 * What each task is allowed to answer.
 *
 * A model returns whatever it returns, so these schemas are the border
 * between "a remote service said something" and "this platform holds a
 * fact" (ADR 0010). Output that does not parse is rejected and nothing is
 * stored — a hallucinated category cannot reach the database, and a runaway
 * answer cannot bloat a row.
 *
 * `confidence` is the provider's own claim about itself. It is displayed as
 * such and never used to apply anything automatically.
 */

const MAX_SUMMARY_TEXT = 800;
const MAX_BULLET = 160;
const MAX_BULLETS = 5;
const MAX_RATIONALE = 280;
const MAX_REPLY_BODY = 1600;
const MAX_FOLLOW_UP = 240;

const confidence = z.number().min(0).max(1);

export const summaryOutputSchema = z.object({
  text: z.string().trim().min(1).max(MAX_SUMMARY_TEXT),
  bullets: z
    .array(z.string().trim().min(1).max(MAX_BULLET))
    .max(MAX_BULLETS)
    .default([]),
});

export const classificationOutputSchema = z.object({
  category: z.enum(SUGGESTION_CATEGORIES),
  confidence,
  rationale: z.string().trim().min(1).max(MAX_RATIONALE),
});

export const priorityOutputSchema = z.object({
  priority: z.enum(TICKET_PRIORITIES),
  confidence,
  rationale: z.string().trim().min(1).max(MAX_RATIONALE),
});

export const replyOutputSchema = z.object({
  body: z.string().trim().min(1).max(MAX_REPLY_BODY),
  /** One question to unblock the ticket, when the thread leaves a gap. */
  followUpQuestion: z.string().trim().min(1).max(MAX_FOLLOW_UP).nullable(),
});

export type SummaryOutput = z.infer<typeof summaryOutputSchema>;
export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;
export type PriorityOutput = z.infer<typeof priorityOutputSchema>;
export type ReplyOutput = z.infer<typeof replyOutputSchema>;

export type SuggestionOutput =
  SummaryOutput | ClassificationOutput | PriorityOutput | ReplyOutput;

/** Output schema per task. Exhaustive by construction: a new task cannot be
 * added to SUGGESTION_TASKS without giving it a schema here. */
export const SUGGESTION_OUTPUT_SCHEMAS: {
  readonly [Task in SuggestionTask]: z.ZodType<SuggestionOutput>;
} = {
  summary: summaryOutputSchema,
  classification: classificationOutputSchema,
  priority: priorityOutputSchema,
  reply: replyOutputSchema,
};

/** The output limits, exported for provider adapters that must ask a model
 * to stay inside them (a prompt can state a limit; only the schema
 * enforces it). */
export const OUTPUT_LIMITS = {
  summaryText: MAX_SUMMARY_TEXT,
  bullet: MAX_BULLET,
  bullets: MAX_BULLETS,
  rationale: MAX_RATIONALE,
  replyBody: MAX_REPLY_BODY,
  followUpQuestion: MAX_FOLLOW_UP,
} as const;

/** Human-readable task labels, used in errors and in Swagger examples. */
export const TASK_LABELS: Record<SuggestionTask, string> = {
  summary: 'Summary',
  classification: 'Classification',
  priority: 'Priority suggestion',
  reply: 'Reply draft',
};

/** Guard used by the persistence layer when reading rows back: a row whose
 * output no longer parses is a bug, not something to render. */
export function parseOutput(
  task: SuggestionTask,
  candidate: unknown,
): SuggestionOutput {
  return SUGGESTION_OUTPUT_SCHEMAS[task].parse(candidate);
}

/** All task names, re-exported so callers need one import. */
export const ALL_TASKS = SUGGESTION_TASKS;
