import { randomUUID } from 'node:crypto';
import type { Actor } from '@helpdesk-ai/security';
import {
  ForbiddenAiActionError,
  ProviderOutputError,
  ProviderUnavailableError,
  TicketNotFoundError,
} from '../../domain/errors';
import type { SuggestionTask } from '../../domain/suggestion';
import {
  buildTicketContext,
  CONTEXT_LIMITS,
  hashTicketContext,
} from '../build-ticket-context';
import type {
  SourceComment,
  SourceTicketSnapshot,
} from '../ports/ticket-source';
import {
  FakeClock,
  FakeSuggestionRepository,
  FakeTicketSource,
  RecordingEventPublisher,
  ScriptedAiProvider,
} from '../testing/fakes';
import { GenerateSuggestionUseCase } from './generate-suggestion';
import {
  GetSuggestionHistoryUseCase,
  ListSuggestionsUseCase,
} from './suggestion-queries';

const REQUESTER_ID = randomUUID();
const TICKET_ID = randomUUID();

const staff: Actor = { id: randomUUID(), roles: ['agent'] };
const requester: Actor = { id: REQUESTER_ID, roles: ['user'] };

const VALID_OUTPUTS: Record<SuggestionTask, unknown> = {
  summary: { text: 'Cannot sign in since the password reset.', bullets: [] },
  classification: {
    category: 'access',
    confidence: 0.8,
    rationale: 'Mentions sign-in and password.',
  },
  priority: {
    priority: 'high',
    confidence: 0.6,
    rationale: 'The requester cannot work.',
  },
  reply: { body: 'Thanks for reporting this.', followUpQuestion: null },
};

function comment(overrides: Partial<SourceComment> = {}): SourceComment {
  return {
    authorId: REQUESTER_ID,
    body: 'I still cannot sign in.',
    internal: false,
    createdAt: '2026-07-29T09:00:00.000Z',
    ...overrides,
  };
}

function snapshot(
  overrides: {
    ticket?: Partial<SourceTicketSnapshot['ticket']>;
    comments?: SourceComment[];
  } = {},
): SourceTicketSnapshot {
  return {
    ticket: {
      id: TICKET_ID,
      title: 'Cannot sign in',
      description: 'Since the password reset I get an error on every attempt.',
      status: 'open',
      priority: 'medium',
      category: null,
      requesterId: REQUESTER_ID,
      assigneeId: null,
      ...overrides.ticket,
    },
    comments: overrides.comments ?? [comment()],
  };
}

interface Harness {
  generate: GenerateSuggestionUseCase;
  list: ListSuggestionsUseCase;
  history: GetSuggestionHistoryUseCase;
  tickets: FakeTicketSource;
  provider: ScriptedAiProvider;
  suggestions: FakeSuggestionRepository;
  events: RecordingEventPublisher;
}

function harness(source: SourceTicketSnapshot = snapshot()): Harness {
  const tickets = new FakeTicketSource(source);
  const provider = new ScriptedAiProvider({ ...VALID_OUTPUTS });
  const suggestions = new FakeSuggestionRepository();
  const events = new RecordingEventPublisher();
  return {
    tickets,
    provider,
    suggestions,
    events,
    generate: new GenerateSuggestionUseCase(
      tickets,
      provider,
      suggestions,
      events,
      new FakeClock(),
    ),
    list: new ListSuggestionsUseCase(suggestions),
    history: new GetSuggestionHistoryUseCase(suggestions),
  };
}

describe('GenerateSuggestionUseCase', () => {
  it('refuses a requester before reading the ticket or spending budget', async () => {
    const { generate, tickets, provider } = harness();

    await expect(
      generate.execute(requester, {
        ticketId: TICKET_ID,
        task: 'summary',
        accessToken: 'token',
      }),
    ).rejects.toBeInstanceOf(ForbiddenAiActionError);

    expect(tickets.calls).toHaveLength(0);
    expect(provider.requests).toHaveLength(0);
  });

  it('stores the validated answer attributed to the provider that gave it', async () => {
    const { generate, suggestions } = harness();

    const result = await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'classification',
      accessToken: 'token',
    });

    expect(result).toMatchObject({
      ticketId: TICKET_ID,
      task: 'classification',
      output: VALID_OUTPUTS.classification,
      provider: 'scripted',
      model: 'scripted-v1',
      usage: { inputTokens: 120, outputTokens: 40 },
      requestedBy: staff.id,
    });
    expect(result.contextHash).toMatch(/^[0-9a-f]{64}$/);
    expect(suggestions.rows).toEqual([result]);
  });

  it('forwards the caller access token to the ticket source', async () => {
    const { generate, tickets } = harness();

    await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'summary',
      accessToken: 'the-caller-token',
    });

    expect(tickets.calls).toEqual([
      { ticketId: TICKET_ID, accessToken: 'the-caller-token' },
    ]);
  });

  it('never shows internal notes to a provider', async () => {
    const { generate, provider } = harness(
      snapshot({
        comments: [
          comment({ body: 'public question' }),
          comment({
            authorId: staff.id,
            body: 'internal: customer is on the cancellation list',
            internal: true,
          }),
        ],
      }),
    );

    await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'reply',
      accessToken: 'token',
    });

    const seen = provider.requests[0].context.messages;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      authorRole: 'requester',
      body: 'public question',
    });
    expect(JSON.stringify(provider.requests[0].context)).not.toContain(
      'cancellation list',
    );
  });

  it('labels each message by role instead of leaking user ids', async () => {
    const { generate, provider } = harness(
      snapshot({
        comments: [
          comment({ body: 'from the requester' }),
          comment({ authorId: staff.id, body: 'from the technician' }),
        ],
      }),
    );

    await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'summary',
      accessToken: 'token',
    });

    expect(provider.requests[0].context.messages).toEqual([
      expect.objectContaining({ authorRole: 'requester' }),
      expect.objectContaining({ authorRole: 'staff' }),
    ]);
    expect(JSON.stringify(provider.requests[0].context)).not.toContain(
      staff.id,
    );
  });

  it('rejects an off-schema answer and stores nothing', async () => {
    const { generate, provider, suggestions, events } = harness();
    provider.answerWith({
      classification: { category: 'teleportation', confidence: 2 },
    });

    await expect(
      generate.execute(staff, {
        ticketId: TICKET_ID,
        task: 'classification',
        accessToken: 'token',
      }),
    ).rejects.toBeInstanceOf(ProviderOutputError);

    expect(suggestions.rows).toHaveLength(0);
    expect(events.published).toHaveLength(0);
  });

  it('reports a provider crash as unavailability, not as a stored suggestion', async () => {
    const { generate, provider, suggestions } = harness();
    provider.failure = new Error('socket hang up');

    await expect(
      generate.execute(staff, {
        ticketId: TICKET_ID,
        task: 'summary',
        accessToken: 'token',
      }),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);

    expect(suggestions.rows).toHaveLength(0);
  });

  it('sanitizes a raw provider crash while re-wrapping it', async () => {
    // The gap this closes: an adapter that throws something which is not a
    // domain error has its message re-wrapped here, one layer above the
    // adapter's own redaction. A transport error that echoes the request it
    // tried to send would otherwise travel straight to the HTTP client.
    const { generate, provider, suggestions } = harness();
    const leaked = 'test-key-0000-not-a-real-credential';
    provider.failure = new Error('fetch failed', {
      cause: new Error(
        `request headers {"x-goog-api-key":"${leaked}"} to https://example.test`,
      ),
    });

    const failure = await generate
      .execute(staff, {
        ticketId: TICKET_ID,
        task: 'summary',
        accessToken: 'token',
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderUnavailableError);
    expect((failure as Error).message).not.toContain(leaked);
    expect((failure as Error).message).toContain('[redacted]');
    // The nested cause is still reported — redaction removes the credential,
    // not the diagnosis.
    expect((failure as Error).message).toContain('fetch failed');
    expect(suggestions.rows).toHaveLength(0);
  });

  it('lets a domain error raised by an adapter through untouched', async () => {
    const { generate, provider } = harness();
    provider.failure = new ProviderUnavailableError('scripted', 'rate limited');

    await expect(
      generate.execute(staff, {
        ticketId: TICKET_ID,
        task: 'summary',
        accessToken: 'token',
      }),
    ).rejects.toThrow('rate limited');
  });

  it('does not call the provider when the ticket cannot be read', async () => {
    const { generate, tickets, provider } = harness();
    tickets.failure = new TicketNotFoundError();

    await expect(
      generate.execute(staff, {
        ticketId: TICKET_ID,
        task: 'summary',
        accessToken: 'token',
      }),
    ).rejects.toBeInstanceOf(TicketNotFoundError);

    expect(provider.requests).toHaveLength(0);
  });

  it('announces the suggestion with metadata only — never its content', async () => {
    const { generate, events } = harness();

    const result = await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'reply',
      accessToken: 'token',
    });

    expect(events.published).toEqual([
      {
        suggestionId: result.id,
        ticketId: TICKET_ID,
        task: 'reply',
        provider: 'scripted',
        model: 'scripted-v1',
        requestedBy: staff.id,
        createdAt: result.createdAt,
      },
    ]);
    expect(JSON.stringify(events.published)).not.toContain(
      'Thanks for reporting',
    );
  });

  it('measures provider latency on the monotonic clock', async () => {
    const { generate } = harness();

    const result = await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'summary',
      accessToken: 'token',
    });

    // FakeClock advances 250ms per read: one read before, one after.
    expect(result.latencyMs).toBe(250);
  });

  it('passes the same limits to every provider call', async () => {
    const { generate, provider } = harness();

    await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'summary',
      accessToken: 'token',
    });
    await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'reply',
      accessToken: 'token',
    });

    expect(provider.requests[0].limits).toEqual(provider.requests[1].limits);
    expect(provider.requests[0].limits.timeoutMs).toBeGreaterThan(0);
    expect(provider.requests[0].limits.maxOutputTokens).toBeGreaterThan(0);
  });
});

describe('ticket context', () => {
  it('keeps the newest messages in chronological order and flags the cut', () => {
    const comments = Array.from(
      { length: CONTEXT_LIMITS.messages + 4 },
      (_, index) =>
        comment({
          body: `message ${index}`,
          createdAt: `2026-07-29T09:${String(index).padStart(2, '0')}:00.000Z`,
        }),
    );

    const context = buildTicketContext(snapshot({ comments }));

    expect(context.messages).toHaveLength(CONTEXT_LIMITS.messages);
    expect(context.messages[0].body).toBe('message 4');
    expect(context.messages.at(-1)?.body).toBe(
      `message ${CONTEXT_LIMITS.messages + 3}`,
    );
    expect(context.truncated).toBe(true);
  });

  it('marks a truncated description instead of pretending it is whole', () => {
    const context = buildTicketContext(
      snapshot({
        ticket: { description: 'word '.repeat(CONTEXT_LIMITS.description) },
      }),
    );

    expect(context.description.length).toBeLessThanOrEqual(
      CONTEXT_LIMITS.description + 1,
    );
    expect(context.description.endsWith('…')).toBe(true);
    expect(context.truncated).toBe(true);
  });

  it('does not flag a short ticket as truncated', () => {
    expect(buildTicketContext(snapshot()).truncated).toBe(false);
  });

  it('hashes identical contexts identically and changed threads differently', () => {
    const first = buildTicketContext(snapshot());
    const same = buildTicketContext(snapshot());
    const changed = buildTicketContext(
      snapshot({ comments: [comment(), comment({ body: 'one more thing' })] }),
    );

    expect(hashTicketContext(first)).toBe(hashTicketContext(same));
    expect(hashTicketContext(changed)).not.toBe(hashTicketContext(first));
  });
});

describe('suggestion queries', () => {
  it('refuses a requester', async () => {
    const { list, history } = harness();

    await expect(list.execute(requester, TICKET_ID)).rejects.toBeInstanceOf(
      ForbiddenAiActionError,
    );
    await expect(
      history.execute(requester, TICKET_ID, 'summary'),
    ).rejects.toBeInstanceOf(ForbiddenAiActionError);
  });

  it('returns the newest suggestion per task', async () => {
    const { generate, list, suggestions } = harness();
    await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'summary',
      accessToken: 'token',
    });
    const newer = await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'summary',
      accessToken: 'token',
    });
    await generate.execute(staff, {
      ticketId: TICKET_ID,
      task: 'priority',
      accessToken: 'token',
    });

    const latest = await list.execute(staff, TICKET_ID);

    // Three rows appended (append-only), two surfaced (newest per task).
    expect(suggestions.rows).toHaveLength(3);
    expect(latest.map((row) => row.task).sort()).toEqual([
      'priority',
      'summary',
    ]);
    expect(latest.find((row) => row.task === 'summary')?.id).toBe(newer.id);
  });

  it('caps a history request', async () => {
    const { history, suggestions } = harness();
    const base = {
      ticketId: TICKET_ID,
      task: 'summary' as SuggestionTask,
      output: VALID_OUTPUTS.summary as { text: string; bullets: string[] },
      provider: 'scripted',
      model: 'scripted-v1',
      contextHash: 'a'.repeat(64),
      usage: null,
      latencyMs: 1,
      requestedBy: staff.id,
    };
    for (let index = 0; index < 25; index += 1) {
      await suggestions.append({
        ...base,
        id: randomUUID(),
        createdAt: new Date(Date.UTC(2026, 6, 29, 10, index)),
      });
    }

    expect(
      await history.execute(staff, TICKET_ID, 'summary', 999),
    ).toHaveLength(20);
    expect(await history.execute(staff, TICKET_ID, 'summary', 3)).toHaveLength(
      3,
    );
  });
});
