'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  generateSuggestion,
  getAiProvider,
  listSuggestions,
  SUGGESTION_TASKS,
  type AiProviderInfo,
  type ClassificationOutput,
  type PriorityOutput,
  type ReplyOutput,
  type Suggestion,
  type SuggestionTask,
  type SummaryOutput,
} from '../lib/ai';
import { relativeTime } from '../lib/format';
import { PRIORITY_LABELS } from './ui/status';
import type { TicketPriority } from '../lib/tickets';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { FormError } from './ui/field';
import { SparklesIcon } from './ui/icons';
import styles from './ai-suggestions.module.css';

/**
 * Staff-only AI panel on a ticket.
 *
 * Three product rules are visible in this component, not just implied:
 *
 * - **Nothing is applied.** Every panel shows text a technician reads,
 *   edits and uses; no button here changes the ticket.
 * - **The source is always named.** The provider and model that answered
 *   are shown next to each suggestion, and when the provider is the local
 *   deterministic one the panel says plainly that no language model is
 *   connected. A placeholder presented as a model's opinion would be worse
 *   than no panel at all.
 * - **Nothing is generated on its own.** Each task runs when someone asks
 *   for it, because every run spends quota — or money — against whichever
 *   provider the deployment configured.
 *
 * The caller renders this only for staff; the API refuses everyone else, so
 * a mistake here is a cosmetic bug rather than a data leak.
 */

const TASK_LABELS: Record<SuggestionTask, string> = {
  summary: 'Summary',
  classification: 'Category',
  priority: 'Priority',
  reply: 'Reply draft',
};

const TASK_HINTS: Record<SuggestionTask, string> = {
  summary: 'The thread condensed to what you need before reading it.',
  classification: 'A suggested category, with the words it was based on.',
  priority: 'An urgency estimate to compare against the current priority.',
  reply: 'A first response for you to review, edit and send yourself.',
};

interface TaskState {
  loading: boolean;
  error: string | null;
}

const IDLE: TaskState = { loading: false, error: null };

export function AiSuggestions({
  ticketId,
  accessToken,
}: {
  ticketId: string;
  accessToken: string;
}) {
  const [provider, setProvider] = useState<AiProviderInfo | null>(null);
  const [suggestions, setSuggestions] = useState<
    Partial<Record<SuggestionTask, Suggestion>>
  >({});
  const [states, setStates] = useState<Record<SuggestionTask, TaskState>>({
    summary: IDLE,
    classification: IDLE,
    priority: IDLE,
    reply: IDLE,
  });
  const [panelError, setPanelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [info, existing] = await Promise.all([
        getAiProvider(accessToken),
        listSuggestions(accessToken, ticketId),
      ]);
      setProvider(info);
      setSuggestions(
        Object.fromEntries(existing.map((row) => [row.task, row])) as Partial<
          Record<SuggestionTask, Suggestion>
        >,
      );
      setPanelError(null);
    } catch (error) {
      setPanelError(
        error instanceof Error ? error.message : 'AI assistance is unavailable',
      );
    }
  }, [accessToken, ticketId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(task: SuggestionTask) {
    setStates((current) => ({
      ...current,
      [task]: { loading: true, error: null },
    }));
    try {
      const suggestion = await generateSuggestion(accessToken, ticketId, task);
      setSuggestions((current) => ({ ...current, [task]: suggestion }));
      setStates((current) => ({ ...current, [task]: IDLE }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [task]: {
          loading: false,
          error:
            error instanceof Error
              ? error.message
              : 'The suggestion could not be generated',
        },
      }));
    }
  }

  return (
    <section className={styles.panel} aria-labelledby="ai-panel-title">
      <header className={styles.header}>
        <h2 id="ai-panel-title" className={styles.title}>
          <SparklesIcon size={16} />
          AI assistance
        </h2>
        <p className={styles.lead}>
          Suggestions for you to review. Nothing here changes the ticket, and
          nothing runs until you ask for it.
        </p>
        {provider ? <ProviderNotice provider={provider} /> : null}
      </header>

      {panelError ? <FormError>{panelError}</FormError> : null}

      <ul className={styles.tasks}>
        {SUGGESTION_TASKS.map((task) => (
          <li key={task}>
            <Card className={styles.task}>
              <div className={styles.taskHeader}>
                <div>
                  <h3 className={styles.taskTitle}>{TASK_LABELS[task]}</h3>
                  <p className={styles.taskHint}>{TASK_HINTS[task]}</p>
                </div>
                {/* Four buttons with the same visible word would be four
                    identical stops for a screen reader, so each one names
                    its task in its accessible label. */}
                <Button
                  variant="secondary"
                  size="sm"
                  loading={states[task].loading}
                  aria-label={`${suggestions[task] ? 'Regenerate' : 'Generate'} ${TASK_LABELS[
                    task
                  ].toLowerCase()}`}
                  onClick={() => void run(task)}
                >
                  {suggestions[task] ? 'Regenerate' : 'Generate'}
                </Button>
              </div>

              <div className={styles.taskBody} aria-live="polite">
                {states[task].error ? (
                  <p className={styles.taskError}>{states[task].error}</p>
                ) : null}
                {suggestions[task] ? (
                  <SuggestionBody
                    suggestion={suggestions[task] as Suggestion}
                  />
                ) : states[task].loading ? (
                  <p className={styles.pending}>Asking the provider…</p>
                ) : states[task].error ? null : (
                  <p className={styles.pending}>Not generated yet.</p>
                )}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Names the provider, and says what the local one actually is. */
function ProviderNotice({ provider }: { provider: AiProviderInfo }) {
  if (provider.id === 'local') {
    return (
      <p className={styles.notice}>
        <strong>No language model is connected.</strong> Answers come from{' '}
        <code>{provider.model}</code>, a deterministic keyword-and-template
        provider that ships with the service so this feature can be used and
        tested end to end. Treat the wording as a placeholder, not as a
        model&apos;s opinion.
      </p>
    );
  }

  return (
    <p className={styles.notice}>
      Answers come from <code>{provider.id}</code> using{' '}
      <code>{provider.model}</code>. Every suggestion is reviewed by you before
      it reaches anyone.
    </p>
  );
}

function SuggestionBody({ suggestion }: { suggestion: Suggestion }) {
  return (
    <div className={styles.result}>
      {suggestion.task === 'summary' ? (
        <SummaryView output={suggestion.output as SummaryOutput} />
      ) : null}
      {suggestion.task === 'classification' ? (
        <ClassificationView
          output={suggestion.output as ClassificationOutput}
        />
      ) : null}
      {suggestion.task === 'priority' ? (
        <PriorityView output={suggestion.output as PriorityOutput} />
      ) : null}
      {suggestion.task === 'reply' ? (
        <ReplyView output={suggestion.output as ReplyOutput} />
      ) : null}
      <SuggestionMeta suggestion={suggestion} />
    </div>
  );
}

function SummaryView({ output }: { output: SummaryOutput }) {
  return (
    <>
      <p className={styles.text}>{output.text}</p>
      {output.bullets.length > 0 ? (
        <ul className={styles.bullets}>
          {output.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function ClassificationView({ output }: { output: ClassificationOutput }) {
  return (
    <>
      <p className={styles.verdict}>
        <span className={styles.pill}>{output.category}</span>
        <Confidence value={output.confidence} />
      </p>
      <p className={styles.rationale}>{output.rationale}</p>
    </>
  );
}

function PriorityView({ output }: { output: PriorityOutput }) {
  const label =
    PRIORITY_LABELS[output.priority as TicketPriority] ?? output.priority;
  return (
    <>
      <p className={styles.verdict}>
        <span className={styles.pill}>{label}</span>
        <Confidence value={output.confidence} />
      </p>
      <p className={styles.rationale}>{output.rationale}</p>
      <p className={styles.rationale}>
        Change the priority yourself if you agree — this panel never does.
      </p>
    </>
  );
}

function ReplyView({ output }: { output: ReplyOutput }) {
  return (
    <>
      <p className={styles.draft}>{output.body}</p>
      {output.followUpQuestion ? (
        <p className={styles.rationale}>
          Suggested question: {output.followUpQuestion}
        </p>
      ) : null}
      <p className={styles.rationale}>
        Copy it into the comment box below, edit it, and send it as yourself.
      </p>
    </>
  );
}

/** The provider's own claim about itself, labeled as exactly that. */
function Confidence({ value }: { value: number }) {
  return (
    <span className={styles.confidence}>
      provider confidence {Math.round(value * 100)}%
    </span>
  );
}

function SuggestionMeta({ suggestion }: { suggestion: Suggestion }) {
  const when = relativeTime(suggestion.createdAt);
  const tokens = suggestion.usage
    ? `${suggestion.usage.inputTokens + suggestion.usage.outputTokens} tokens`
    : 'no tokens';
  return (
    <p className={styles.meta}>
      {suggestion.provider} · {suggestion.model}
      {when ? ` · ${when}` : ''} · {suggestion.latencyMs} ms · {tokens}
    </p>
  );
}
