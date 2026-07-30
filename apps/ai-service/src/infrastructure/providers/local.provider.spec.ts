import type { TicketContext } from '../../domain/suggestion';
import { LocalHeuristicProvider } from './local.provider';
import { checkAiProviderContract } from './provider-contract';

function context(overrides: Partial<TicketContext> = {}): TicketContext {
  return {
    ticketId: '44444444-4444-4444-8444-444444444444',
    title: 'Cannot sign in',
    description: 'After the password reset every login attempt fails.',
    status: 'open',
    currentPriority: 'medium',
    currentCategory: null,
    messages: [],
    truncated: false,
    ...overrides,
  };
}

const provider = new LocalHeuristicProvider();

async function answer(
  task: 'summary' | 'classification' | 'priority' | 'reply',
  ctx: TicketContext,
) {
  const result = await provider.run({
    task,
    context: ctx,
    limits: { timeoutMs: 20_000, maxOutputTokens: 700 },
  });
  return result;
}

describe('LocalHeuristicProvider', () => {
  it('satisfies the AiProvider contract', async () => {
    expect(await checkAiProviderContract(provider)).toEqual([]);
  });

  it('presents itself as what it is, and claims no token spend', async () => {
    expect(provider.id).toBe('local');
    expect(provider.model).toBe('heuristics-v1');
    expect((await answer('summary', context())).usage).toBeNull();
  });

  it('is deterministic: the same context always gives the same answer', async () => {
    const first = await answer('reply', context());
    const second = await answer('reply', context());

    expect(second.data).toEqual(first.data);
  });

  it('classifies by keyword and names the words it matched', async () => {
    const result = (await answer('classification', context())).data as {
      category: string;
      rationale: string;
      confidence: number;
    };

    expect(result.category).toBe('access');
    expect(result.rationale).toContain('password');
    expect(result.confidence).toBeGreaterThan(0.2);
    expect(result.confidence).toBeLessThanOrEqual(0.9);
  });

  it('falls back to "other" with low confidence when nothing matches', async () => {
    const result = (
      await answer(
        'classification',
        context({
          title: 'Question about the office plants',
          description: 'Who waters them during the summer break?',
        }),
      )
    ).data as { category: string; confidence: number };

    expect(result).toMatchObject({ category: 'other', confidence: 0.2 });
  });

  it('escalates to urgent when the wording says work is stopped', async () => {
    const result = (
      await answer(
        'priority',
        context({
          description: 'There is a full outage, nobody can print invoices.',
          currentPriority: 'low',
        }),
      )
    ).data as { priority: string; rationale: string };

    expect(result.priority).toBe('urgent');
    expect(result.rationale).toContain('outage');
  });

  it('raises one level on urgency wording instead of jumping to urgent', async () => {
    const result = (
      await answer(
        'priority',
        context({
          description: 'I am blocked and need this asap.',
          currentPriority: 'low',
        }),
      )
    ).data as { priority: string };

    expect(result.priority).toBe('medium');
  });

  it('lowers the priority when the requester says it can wait', async () => {
    const result = (
      await answer(
        'priority',
        context({
          description: 'No rush, whenever you have time.',
          currentPriority: 'high',
        }),
      )
    ).data as { priority: string };

    expect(result.priority).toBe('medium');
  });

  it('keeps the current priority when the text says nothing about urgency', async () => {
    const result = (
      await answer(
        'priority',
        context({
          description: 'The monitor shows a pink line on the left edge.',
          currentPriority: 'medium',
        }),
      )
    ).data as { priority: string; confidence: number };

    expect(result).toMatchObject({ priority: 'medium', confidence: 0.3 });
  });

  it('summarizes what a technician needs before opening the thread', async () => {
    const result = (
      await answer(
        'summary',
        context({
          status: 'in_progress',
          messages: [
            {
              authorRole: 'requester',
              body: 'Still failing this morning.',
              at: '2026-07-29T08:00:00.000Z',
            },
          ],
        }),
      )
    ).data as { text: string; bullets: string[] };

    expect(result.text).toContain('in progress');
    expect(result.text).toContain('the wording points to account access');
    expect(result.bullets.length).toBeGreaterThan(2);
  });

  it('says so when it only saw part of a long thread', async () => {
    const result = (await answer('summary', context({ truncated: true })))
      .data as { bullets: string[] };

    expect(result.bullets.join(' ')).toContain('most recent part');
  });

  it('drafts a first reply with one clarifying question', async () => {
    const result = (await answer('reply', context())).data as {
      body: string;
      followUpQuestion: string | null;
    };

    expect(result.body).toContain('Thanks for reporting this');
    // The requester's own words are quoted, not spliced into the sentence.
    expect(result.body).toContain('“Cannot sign in”');
    expect(result.followUpQuestion).toBe(
      'What exact message appears when you try to sign in, and when did it start?',
    );
    expect(result.body).toContain(result.followUpQuestion as string);
  });

  it('stops re-asking once the conversation is under way', async () => {
    const result = (
      await answer(
        'reply',
        context({
          messages: [
            {
              authorRole: 'staff',
              body: 'Looking into it.',
              at: '2026-07-29T08:00:00.000Z',
            },
            {
              authorRole: 'staff',
              body: 'Could you try the other browser?',
              at: '2026-07-29T09:00:00.000Z',
            },
          ],
        }),
      )
    ).data as { body: string; followUpQuestion: string | null };

    expect(result.followUpQuestion).toBeNull();
    expect(result.body).toContain('Thanks for the extra detail');
  });

  it('offers the requester the close, not a promise, on a resolved ticket', async () => {
    const result = (await answer('reply', context({ status: 'resolved' })))
      .data as { body: string };

    expect(result.body).toContain('confirm and close');
  });
});
