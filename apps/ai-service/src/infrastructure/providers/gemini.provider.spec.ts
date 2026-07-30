import {
  ProviderOutputError,
  ProviderUnavailableError,
} from '../../domain/errors';
import {
  SUGGESTION_CATEGORIES,
  TICKET_PRIORITIES,
  type SuggestionTask,
  type TicketContext,
} from '../../domain/suggestion';
import {
  classificationOutputSchema,
  priorityOutputSchema,
  replyOutputSchema,
  summaryOutputSchema,
} from '../../domain/suggestion-outputs';
import {
  GEMINI_ENDPOINT,
  GEMINI_RESPONSE_SCHEMAS,
  GeminiProvider,
} from './gemini.provider';
import { checkAiProviderContract } from './provider-contract';

const TEST_KEY = 'test-key-0000-not-a-real-credential';

const LIMITS = { timeoutMs: 20_000, maxOutputTokens: 700 } as const;

function context(overrides: Partial<TicketContext> = {}): TicketContext {
  return {
    ticketId: '55555555-5555-4555-8555-555555555555',
    title: 'Cannot sign in',
    description: 'Every attempt fails since the password reset.',
    status: 'open',
    currentPriority: 'medium',
    currentCategory: null,
    messages: [],
    truncated: false,
    ...overrides,
  };
}

const ANSWERS: Record<SuggestionTask, unknown> = {
  summary: {
    text: 'Sign-in fails after a password reset.',
    bullets: ['Access'],
  },
  classification: {
    category: 'access',
    confidence: 0.8,
    rationale: 'password, sign in',
  },
  priority: {
    priority: 'high',
    confidence: 0.6,
    rationale: 'the requester cannot work',
  },
  reply: { body: 'Thanks for reporting this.', followUpQuestion: null },
};

interface SentRequest {
  url: string;
  headers: Record<string, string>;
  body: {
    model: string;
    input: string;
    system_instruction: string;
    generation_config: { max_output_tokens: number };
    response_format: {
      type: string;
      mime_type: string;
      schema: { properties: Record<string, unknown> };
    };
  };
  hasSignal: boolean;
}

function taskOf(sent: SentRequest): SuggestionTask {
  const properties = Object.keys(sent.body.response_format.schema.properties);
  if (properties.includes('category')) return 'classification';
  if (properties.includes('priority')) return 'priority';
  if (properties.includes('body')) return 'reply';
  return 'summary';
}

function interaction(text: string, usage?: unknown): unknown {
  return {
    id: 'int_1',
    model: 'gemini-3.5-flash-lite-002',
    object: 'interaction',
    status: 'completed',
    steps: [
      { type: 'user_input', content: [{ type: 'text', text: 'ignored' }] },
      { type: 'model_output', content: [{ type: 'text', text }] },
    ],
    ...(usage === undefined
      ? { usage: { total_input_tokens: 412, total_output_tokens: 88 } }
      : { usage }),
  };
}

interface Harness {
  provider: GeminiProvider;
  sent: SentRequest[];
}

function harness(
  respond: (sent: SentRequest) => Response | Promise<Response>,
): Harness {
  const sent: SentRequest[] = [];
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const record: SentRequest = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)),
      hasSignal: Boolean(init?.signal),
    };
    sent.push(record);
    return Promise.resolve(respond(record));
  }) as unknown as typeof fetch;

  return {
    sent,
    provider: new GeminiProvider({
      apiKey: TEST_KEY,
      model: 'gemini-3.5-flash-lite',
      fetchImpl,
    }),
  };
}

/** The happy-path transport: answers whatever task was asked for. */
function answering(): Harness {
  return harness(
    (request) =>
      new Response(
        JSON.stringify(interaction(JSON.stringify(ANSWERS[taskOf(request)]))),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('GeminiProvider', () => {
  it('satisfies the AiProvider contract', async () => {
    const { provider } = answering();

    expect(await checkAiProviderContract(provider)).toEqual([]);
  });

  it('sends the key as a header and never in the URL', async () => {
    const { provider, sent } = answering();

    await provider.run({ task: 'summary', context: context(), limits: LIMITS });

    expect(sent[0].url).toBe(GEMINI_ENDPOINT);
    expect(sent[0].url).not.toContain('key');
    expect(sent[0].url).not.toContain(TEST_KEY);
    expect(sent[0].headers['x-goog-api-key']).toBe(TEST_KEY);
  });

  it('asks for JSON constrained by a schema, and applies the caller limits', async () => {
    const { provider, sent } = answering();

    await provider.run({
      task: 'classification',
      context: context(),
      limits: LIMITS,
    });

    expect(sent[0].body.response_format).toMatchObject({
      type: 'text',
      mime_type: 'application/json',
    });
    expect(sent[0].body.generation_config.max_output_tokens).toBe(
      LIMITS.maxOutputTokens,
    );
    // The timeout is expressed as an abort signal, so a hung provider cannot
    // hold the request open.
    expect(sent[0].hasSignal).toBe(true);
    expect(sent[0].body.model).toBe('gemini-3.5-flash-lite');
  });

  it('describes the ticket by role, and says when the thread was shortened', async () => {
    const { provider, sent } = answering();

    await provider.run({
      task: 'reply',
      context: context({
        truncated: true,
        messages: [
          {
            authorRole: 'requester',
            body: 'still failing',
            at: '2026-07-30T08:00:00.000Z',
          },
        ],
      }),
      limits: LIMITS,
    });

    const prompt = sent[0].body.input;
    expect(prompt).toContain('[requester] still failing');
    expect(prompt).toContain('shortened');
    // Guards against a prompt edit quietly dropping the anti-fabrication
    // rule: without it the model is free to fill gaps with plausible
    // inventions, which is the worst failure mode for a triage suggestion.
    expect(sent[0].body.system_instruction).toContain('Never invent facts');
  });

  it('returns the model that answered and the tokens it reported', async () => {
    const { provider } = answering();

    const result = await provider.run({
      task: 'summary',
      context: context(),
      limits: LIMITS,
    });

    expect(result.data).toEqual(ANSWERS.summary);
    expect(result.model).toBe('gemini-3.5-flash-lite-002');
    expect(result.usage).toEqual({ inputTokens: 412, outputTokens: 88 });
  });

  it('reports unknown token usage as null rather than as zero', async () => {
    const { provider } = harness(() =>
      jsonResponse(
        interaction(JSON.stringify(ANSWERS.summary), { total_tokens: 500 }),
        200,
      ),
    );

    const result = await provider.run({
      task: 'summary',
      context: context(),
      limits: LIMITS,
    });

    expect(result.usage).toBeNull();
  });

  it('treats a non-JSON answer as an output problem, not an outage', async () => {
    const { provider } = harness(() =>
      jsonResponse(interaction('Sure! Here is your summary:'), 200),
    );

    await expect(
      provider.run({ task: 'summary', context: context(), limits: LIMITS }),
    ).rejects.toBeInstanceOf(ProviderOutputError);
  });

  it('treats a response with no model output as an outage', async () => {
    const { provider } = harness(() =>
      jsonResponse({ id: 'int_2', steps: [] }, 200),
    );

    await expect(
      provider.run({ task: 'summary', context: context(), limits: LIMITS }),
    ).rejects.toThrow(/no model output/);
  });

  it('surfaces rate limiting as unavailability, with the provider explanation', async () => {
    const { provider } = harness(() =>
      jsonResponse(
        { error: { message: 'Quota exceeded for requests per day' } },
        429,
      ),
    );

    const failure = await provider
      .run({ task: 'summary', context: context(), limits: LIMITS })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderUnavailableError);
    expect((failure as Error).message).toContain('rate limited');
    expect((failure as Error).message).toContain('Quota exceeded');
  });

  it('surfaces a transport failure as unavailability', async () => {
    const { provider } = harness(() => {
      throw new Error('connect ETIMEDOUT');
    });

    await expect(
      provider.run({ task: 'summary', context: context(), limits: LIMITS }),
    ).rejects.toThrow(/ETIMEDOUT/);
  });

  it('never lets the key escape inside an error message', async () => {
    // Both plausible leak paths: a transport error that echoes the request,
    // and an upstream body that quotes the credential back.
    const echoing = harness(() => {
      throw new Error(`request failed with x-goog-api-key: ${TEST_KEY}`);
    });
    const quoting = harness(() =>
      jsonResponse(
        { error: { message: `API key not valid: ${TEST_KEY}` } },
        400,
      ),
    );

    for (const { provider } of [echoing, quoting]) {
      const failure = await provider
        .run({ task: 'summary', context: context(), limits: LIMITS })
        .catch((error: unknown) => error);

      expect((failure as Error).message).not.toContain(TEST_KEY);
      expect((failure as Error).message).toContain('[redacted]');
    }
  });

  it('keeps the key out of every failure shape an upstream can produce', async () => {
    // One test per way the credential can come back at us. They are listed
    // together because the guarantee is "no path leaks", not "this path does
    // not leak" — a new branch in run() should have to join this table.
    const cases: Array<[name: string, harness: Harness]> = [
      [
        'a transport error echoing the request configuration',
        harness(() => {
          throw new Error('fetch failed', {
            cause: new Error(
              `sent {"headers":{"x-goog-api-key":"${TEST_KEY}"},"url":"https://example.test"}`,
            ),
          });
        }),
      ],
      [
        'a 4xx quoting the credential back',
        harness(() =>
          jsonResponse(
            { error: { message: `API key not valid: ${TEST_KEY}` } },
            400,
          ),
        ),
      ],
      [
        'a 5xx quoting the credential back',
        harness(() =>
          jsonResponse(
            {
              error: {
                message: `internal error handling authorization: Bearer ${TEST_KEY}`,
              },
            },
            503,
          ),
        ),
      ],
      [
        'a thrown object rather than an Error',
        harness(() => {
          throw { headers: { 'x-goog-api-key': TEST_KEY } };
        }),
      ],
    ];

    for (const [, { provider }] of cases) {
      const failure = await provider
        .run({ task: 'summary', context: context(), limits: LIMITS })
        .catch((error: unknown) => error);

      expect((failure as Error).message).not.toContain(TEST_KEY);
      expect((failure as Error).message).toContain('[redacted]');
    }
  });

  it('keeps its response schemas in step with the domain schemas', () => {
    // Drift guard: the JSON Schema sent to Gemini and the zod schema that
    // validates the answer must agree, or the model is asked for one shape
    // and judged against another.
    const cases = [
      { task: 'summary' as SuggestionTask, zod: summaryOutputSchema },
      {
        task: 'classification' as SuggestionTask,
        zod: classificationOutputSchema,
      },
      { task: 'priority' as SuggestionTask, zod: priorityOutputSchema },
      { task: 'reply' as SuggestionTask, zod: replyOutputSchema },
    ];

    for (const { task, zod } of cases) {
      const sent = GEMINI_RESPONSE_SCHEMAS[task] as {
        properties: Record<string, { enum?: string[] }>;
        required: string[];
      };
      expect(Object.keys(sent.properties).sort()).toEqual(
        Object.keys(zod.shape).sort(),
      );
      expect(sent.required.sort()).toEqual(Object.keys(zod.shape).sort());
    }

    expect(
      (
        GEMINI_RESPONSE_SCHEMAS.classification as {
          properties: { category: { enum: string[] } };
        }
      ).properties.category.enum,
    ).toEqual([...SUGGESTION_CATEGORIES]);
    expect(
      (
        GEMINI_RESPONSE_SCHEMAS.priority as {
          properties: { priority: { enum: string[] } };
        }
      ).properties.priority.enum,
    ).toEqual([...TICKET_PRIORITIES]);
  });
});
