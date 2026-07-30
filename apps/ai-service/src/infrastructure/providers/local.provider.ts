import type {
  AiProvider,
  AiProviderOutput,
  AiTaskRequest,
} from '../../application/ports/ai-provider';
import {
  SUGGESTION_CATEGORIES,
  TICKET_PRIORITIES,
  type SuggestionCategory,
  type TicketContext,
  type TicketPriority,
} from '../../domain/suggestion';
import { OUTPUT_LIMITS } from '../../domain/suggestion-outputs';

/**
 * The local provider: keyword matching and templates, no network, no cost.
 *
 * It exists so the whole path — read ticket, build context, answer,
 * validate, store, display — is real and testable before a model provider
 * is chosen (ADR 0010). It is a genuine implementation of the port, and it
 * is deliberately not disguised as one: `id` is `local`, `model` is
 * `heuristics-v1`, `usage` is null because no tokens were spent, and both
 * are stored on every suggestion and shown in the UI. Nobody should ever
 * mistake this output for a language model's.
 *
 * Determinism is the property that makes it useful in CI: the same context
 * always produces the same answer, so specs assert content rather than
 * shape. `limits.timeoutMs` is irrelevant here — the work is synchronous
 * string handling — and is honored trivially by finishing immediately.
 */

/**
 * Signals per category, ordered by how specific they are within a category.
 * The category order in SUGGESTION_CATEGORIES also breaks scoring ties, so
 * two categories with equal evidence always resolve the same way.
 */
const CATEGORY_SIGNALS: Record<SuggestionCategory, readonly string[]> = {
  access: [
    'password',
    'sign in',
    'signin',
    'sign-in',
    'log in',
    'login',
    'locked out',
    'locked',
    'mfa',
    '2fa',
    'permission',
    'access',
    'credential',
    'reset',
    'account',
  ],
  hardware: [
    'laptop',
    'printer',
    'monitor',
    'screen',
    'keyboard',
    'mouse',
    'battery',
    'docking',
    'dock',
    'headset',
    'hard drive',
    'disk',
    'hardware',
    'charger',
  ],
  software: [
    'install',
    'installation',
    'update',
    'upgrade',
    'crash',
    'crashes',
    'freezes',
    'application',
    'app ',
    'license',
    'excel',
    'word',
    'browser',
    'software',
    'version',
    'plugin',
  ],
  network: [
    'wifi',
    'wi-fi',
    'vpn',
    'network',
    'connection',
    'internet',
    'dns',
    'proxy',
    'ethernet',
    'offline',
    'timeout',
    'unreachable',
  ],
  billing: [
    'invoice',
    'billing',
    'payment',
    'charge',
    'subscription',
    'refund',
    'purchase order',
    'quote',
    'renewal',
  ],
  // Never matched directly: 'other' is what no evidence resolves to.
  other: [],
};

/** Signals that a ticket is blocking work right now. */
const CRITICAL_SIGNALS = [
  'outage',
  'production down',
  'data loss',
  'security incident',
  'breach',
  'nobody can',
  'everyone is',
  'whole team',
] as const;

const URGENT_SIGNALS = [
  'urgent',
  'asap',
  'immediately',
  'critical',
  'blocked',
  'cannot work',
  'can not work',
  "can't work",
  'deadline',
  'today',
] as const;

const RELAXED_SIGNALS = [
  'no rush',
  'when you have time',
  'whenever',
  'low priority',
  'not urgent',
  'nice to have',
] as const;

/** One clarifying question per category — the thing a technician would ask
 * first if the thread does not already answer it. */
const FOLLOW_UP_QUESTIONS: Record<SuggestionCategory, string> = {
  access:
    'What exact message appears when you try to sign in, and when did it start?',
  hardware:
    'Which device and model is affected, and does the problem also happen undocked?',
  software:
    'Which version of the application are you on, and does the error happen every time?',
  network:
    'Are you on Wi-Fi, VPN or a cable, and does it affect other sites as well?',
  billing:
    'Which invoice or subscription number should we look at, and what amount do you see?',
  other:
    'Could you add one example of what you expected to happen and what happened instead?',
};

const CATEGORY_LABELS: Record<SuggestionCategory, string> = {
  access: 'account access',
  hardware: 'hardware',
  software: 'software',
  network: 'network or connectivity',
  billing: 'billing',
  other: 'general support',
};

export class LocalHeuristicProvider implements AiProvider {
  readonly id = 'local';
  readonly model = 'heuristics-v1';

  async run(request: AiTaskRequest): Promise<AiProviderOutput> {
    const { task, context } = request;
    const data =
      task === 'summary'
        ? summarize(context)
        : task === 'classification'
          ? classify(context)
          : task === 'priority'
            ? suggestPriority(context)
            : draftReply(context);

    // No tokens were spent, and saying otherwise would corrupt the cost
    // reporting this field exists for.
    return { data, model: this.model, usage: null };
  }
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function summarize(context: TicketContext) {
  const { category } = scoreCategories(context);
  const opening = firstSentence(context.description);
  const requesterMessages = context.messages.filter(
    (message) => message.authorRole === 'requester',
  ).length;
  const staffMessages = context.messages.length - requesterMessages;

  const text = clamp(
    [
      `${context.title.replace(/\.$/, '')}: ${opening}`,
      // Phrased without an article so no label needs "a" vs "an" handling.
      `Currently ${readableStatus(context.status)} with ${context.currentPriority} priority; the wording points to ${CATEGORY_LABELS[category]}.`,
      context.messages.length === 0
        ? 'No replies yet.'
        : `The thread has ${requesterMessages} message(s) from the requester and ${staffMessages} from staff; the latest is from the ${context.messages.at(-1)?.authorRole}.`,
    ].join(' '),
    OUTPUT_LIMITS.summaryText,
  );

  const bullets = [
    `Reported: ${clamp(opening, OUTPUT_LIMITS.bullet - 12)}`,
    `Status: ${readableStatus(context.status)}, priority ${context.currentPriority}`,
    `Reads as: ${CATEGORY_LABELS[category]}`,
    context.messages.length > 0
      ? `Latest message (${context.messages.at(-1)?.authorRole}): ${clamp(
          firstSentence(context.messages.at(-1)?.body ?? ''),
          OUTPUT_LIMITS.bullet - 30,
        )}`
      : 'No replies on the thread yet',
    context.truncated
      ? 'Long ticket: this summary saw only the most recent part of the thread'
      : '',
  ].filter((bullet) => bullet.length > 0);

  return { text, bullets: bullets.slice(0, OUTPUT_LIMITS.bullets) };
}

function classify(context: TicketContext) {
  const { category, top, total, matched } = scoreCategories(context);

  // A share-of-evidence score, not a probability. It is reported as the
  // provider's own confidence and never used to apply anything.
  const confidence =
    total === 0
      ? 0.2
      : round2(Math.min(0.9, 0.4 + 0.2 * (top / total) + 0.05 * top));

  const rationale =
    matched.length === 0
      ? 'No category keywords matched, so this falls back to general support.'
      : `Matched ${CATEGORY_LABELS[category]} keywords: ${matched.slice(0, 4).join(', ')}.`;

  return {
    category,
    confidence,
    rationale: clamp(rationale, OUTPUT_LIMITS.rationale),
  };
}

function suggestPriority(context: TicketContext) {
  const haystack = haystackOf(context);
  const critical = CRITICAL_SIGNALS.filter((signal) =>
    haystack.includes(signal),
  );
  const urgent = URGENT_SIGNALS.filter((signal) => haystack.includes(signal));
  const relaxed = RELAXED_SIGNALS.filter((signal) => haystack.includes(signal));

  if (critical.length > 0) {
    return {
      priority: 'urgent' as TicketPriority,
      confidence: 0.65,
      rationale: clamp(
        `Wording suggests work is stopped for more than one person: ${critical.join(', ')}.`,
        OUTPUT_LIMITS.rationale,
      ),
    };
  }

  if (urgent.length > 0) {
    return {
      priority: raise(context.currentPriority),
      confidence: 0.5,
      rationale: clamp(
        `Urgency wording (${urgent.slice(0, 3).join(', ')}) suggests one step above the current ${context.currentPriority} priority.`,
        OUTPUT_LIMITS.rationale,
      ),
    };
  }

  if (relaxed.length > 0) {
    return {
      priority: lower(context.currentPriority),
      confidence: 0.45,
      rationale: clamp(
        `The requester signals it can wait (${relaxed.slice(0, 3).join(', ')}).`,
        OUTPUT_LIMITS.rationale,
      ),
    };
  }

  return {
    priority: context.currentPriority,
    confidence: 0.3,
    rationale:
      'No urgency or patience signals in the text, so the current priority stands.',
  };
}

function draftReply(context: TicketContext) {
  const { category } = scoreCategories(context);
  const staffMessages = context.messages.filter(
    (message) => message.authorRole === 'staff',
  ).length;
  const conversationUnderway = staffMessages >= 2;

  // The title is quoted rather than spliced into the sentence: a ticket
  // title is someone else's words and rarely fits a template grammatically.
  const acknowledgement =
    staffMessages === 0
      ? `Thanks for reporting this. I have your report about “${clamp(firstSentence(context.title), 120)}”.`
      : 'Thanks for the extra detail.';

  const nextStep =
    context.status === 'resolved'
      ? 'I have marked this as resolved. If it is working on your side, you can confirm and close the ticket; if not, reopening it brings it straight back to me.'
      : context.status === 'in_progress'
        ? 'I am working on it now and will update this ticket as soon as I have something concrete.'
        : 'I am picking this up now and will keep this ticket updated as I go.';

  const question = conversationUnderway ? null : FOLLOW_UP_QUESTIONS[category];

  return {
    body: clamp(
      [acknowledgement, nextStep, question].filter(Boolean).join('\n\n'),
      OUTPUT_LIMITS.replyBody,
    ),
    followUpQuestion: question
      ? clamp(question, OUTPUT_LIMITS.followUpQuestion)
      : null,
  };
}

// ---------------------------------------------------------------------------
// Shared heuristics
// ---------------------------------------------------------------------------

interface CategoryScore {
  category: SuggestionCategory;
  /** Number of distinct signals matched for the winning category. */
  top: number;
  /** Number of distinct signals matched across all categories. */
  total: number;
  matched: string[];
}

function scoreCategories(context: TicketContext): CategoryScore {
  const haystack = haystackOf(context);
  let best: SuggestionCategory = 'other';
  let bestMatches: string[] = [];
  let total = 0;

  for (const category of SUGGESTION_CATEGORIES) {
    const matches = CATEGORY_SIGNALS[category].filter((signal) =>
      haystack.includes(signal),
    );
    total += matches.length;
    // Strictly greater keeps the first category in vocabulary order on a
    // tie, which is what makes the result reproducible.
    if (matches.length > bestMatches.length) {
      best = category;
      bestMatches = matches;
    }
  }

  return {
    category: bestMatches.length === 0 ? 'other' : best,
    top: bestMatches.length,
    total,
    matched: bestMatches,
  };
}

function haystackOf(context: TicketContext): string {
  return [
    context.title,
    context.description,
    ...context.messages.map((message) => message.body),
  ]
    .join(' \n ')
    .toLowerCase();
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.*?[.!?])(\s|$)/s.exec(trimmed);
  const sentence = (match?.[1] ?? trimmed).replace(/\s+/g, ' ');
  return sentence.length > 0 ? sentence : 'no description was provided';
}

function readableStatus(status: TicketContext['status']): string {
  return status.replace('_', ' ');
}

function raise(priority: TicketPriority): TicketPriority {
  const index = TICKET_PRIORITIES.indexOf(priority);
  return TICKET_PRIORITIES[Math.min(index + 1, TICKET_PRIORITIES.length - 1)];
}

function lower(priority: TicketPriority): TicketPriority {
  const index = TICKET_PRIORITIES.indexOf(priority);
  return TICKET_PRIORITIES[Math.max(index - 1, 0)];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Hard cut to a schema limit. The schemas reject anything longer, so this
 * is the adapter keeping its own promises rather than a safety net. */
function clamp(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1)}…`;
}
