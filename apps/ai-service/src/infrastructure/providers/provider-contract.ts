import type { AiProvider } from '../../application/ports/ai-provider';
import {
  SUGGESTION_TASKS,
  type SuggestionTask,
  type TicketContext,
} from '../../domain/suggestion';
import { SUGGESTION_OUTPUT_SCHEMAS } from '../../domain/suggestion-outputs';

/**
 * The contract every provider adapter must satisfy, as executable checks.
 *
 * Written as plain functions rather than a shared `describe` block on
 * purpose: it stays free of test-framework globals, so it typechecks as
 * ordinary source and can be run from a spec, from an integration test, or
 * from a script against a real provider when one is connected (ADR 0010).
 *
 * A new adapter is expected to pass this unchanged. If it cannot, the
 * disagreement is about the port, and the port is what should change —
 * not the adapter's specs.
 */

export interface ContractViolation {
  /** Which promise was broken. */
  check: string;
  /** What happened instead, in enough detail to fix it. */
  detail: string;
}

const LIMITS = { timeoutMs: 20_000, maxOutputTokens: 700 } as const;

/** Contexts that exercise the shapes a real ticket can take. */
export const CONTRACT_CONTEXTS: ReadonlyArray<{
  name: string;
  context: TicketContext;
}> = [
  {
    name: 'a fresh ticket with no replies',
    context: {
      ticketId: '11111111-1111-4111-8111-111111111111',
      title: 'Cannot sign in after the password reset',
      description:
        'Since I reset my password yesterday every sign-in attempt fails with an error.',
      status: 'open',
      currentPriority: 'medium',
      currentCategory: null,
      messages: [],
      truncated: false,
    },
  },
  {
    name: 'an ongoing conversation',
    context: {
      ticketId: '22222222-2222-4222-8222-222222222222',
      title: 'VPN drops every few minutes',
      description: 'The VPN connection drops and I lose access to the network.',
      status: 'in_progress',
      currentPriority: 'high',
      currentCategory: 'network',
      messages: [
        {
          authorRole: 'requester',
          body: 'It happened again twice this morning.',
          at: '2026-07-29T08:00:00.000Z',
        },
        {
          authorRole: 'staff',
          body: 'Thanks, I am checking the gateway logs.',
          at: '2026-07-29T08:30:00.000Z',
        },
        {
          authorRole: 'staff',
          body: 'Could you try the backup profile?',
          at: '2026-07-29T09:00:00.000Z',
        },
      ],
      truncated: false,
    },
  },
  {
    name: 'a truncated ticket with an empty description',
    context: {
      ticketId: '33333333-3333-4333-8333-333333333333',
      title: 'Printer',
      description: '',
      status: 'resolved',
      currentPriority: 'low',
      currentCategory: null,
      messages: [
        {
          authorRole: 'requester',
          body: 'urgent: nobody can print and we have a deadline today',
          at: '2026-07-29T07:00:00.000Z',
        },
      ],
      truncated: true,
    },
  },
];

/**
 * Runs every check against `provider` and returns what it broke. An empty
 * array means the adapter honors the port.
 */
export async function checkAiProviderContract(
  provider: AiProvider,
): Promise<ContractViolation[]> {
  const violations: ContractViolation[] = [];

  if (!provider.id.trim()) {
    violations.push({
      check: 'provider identifies itself',
      detail: 'id is empty; suggestions could not be attributed to it',
    });
  }
  if (!provider.model.trim()) {
    violations.push({
      check: 'provider names a default model',
      detail: 'model is empty',
    });
  }

  for (const { name, context } of CONTRACT_CONTEXTS) {
    for (const task of SUGGESTION_TASKS) {
      const frozen = JSON.stringify(context);
      let answer;
      try {
        answer = await provider.run({ task, context, limits: LIMITS });
      } catch (error) {
        violations.push({
          check: `answers ${task} for ${name}`,
          detail: `threw ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }

      violations.push(...checkAnswerShape(task, name, answer));

      if (JSON.stringify(context) !== frozen) {
        violations.push({
          check: `leaves the context unmodified while answering ${task}`,
          detail: `the context passed for ${name} came back mutated`,
        });
      }
    }
  }

  return violations;
}

function checkAnswerShape(
  task: SuggestionTask,
  contextName: string,
  answer: { data: unknown; model: string; usage: unknown },
): ContractViolation[] {
  const violations: ContractViolation[] = [];

  const parsed = SUGGESTION_OUTPUT_SCHEMAS[task].safeParse(answer.data);
  if (!parsed.success) {
    violations.push({
      check: `${task} output matches its schema`,
      detail: `for ${contextName}: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'output'} ${issue.message}`)
        .join('; ')}`,
    });
  }

  if (typeof answer.model !== 'string' || answer.model.trim().length === 0) {
    violations.push({
      check: `${task} answer names the model that produced it`,
      detail: `for ${contextName}: model was ${JSON.stringify(answer.model)}`,
    });
  }

  if (answer.usage !== null) {
    const usage = answer.usage as {
      inputTokens?: unknown;
      outputTokens?: unknown;
    };
    const valid = (value: unknown): boolean =>
      typeof value === 'number' && Number.isInteger(value) && value >= 0;
    if (!valid(usage?.inputTokens) || !valid(usage?.outputTokens)) {
      violations.push({
        check: `${task} reports usage as null or as non-negative integers`,
        detail: `for ${contextName}: usage was ${JSON.stringify(answer.usage)}`,
      });
    }
  }

  return violations;
}
