import { randomUUID } from 'node:crypto';
import type { Suggestion, SuggestionTask } from '../../domain/suggestion';
import { PrismaSuggestionRepository } from './prisma-suggestion.repository';
import { PrismaService } from './prisma.service';

// Runs against helpdesk_ai_test through the test-integration target.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Run via `nx run @helpdesk-ai/ai-service:test-integration` with the compose postgres service up.',
  );
}

/** Collects warnings so the "skip an unreadable row" behavior is observable
 * rather than merely assumed. */
class CapturingLogger {
  readonly warnings: string[] = [];
  readonly otherLevels: string[] = [];

  log(message: string): void {
    this.otherLevels.push(message);
  }

  warn(message: string): void {
    this.warnings.push(message);
  }

  error(message: string): void {
    this.otherLevels.push(message);
  }
}

describe('PrismaSuggestionRepository (real PostgreSQL)', () => {
  const prisma = new PrismaService(databaseUrl);
  const logger = new CapturingLogger();
  const repository = new PrismaSuggestionRepository(prisma, logger);

  const ticketId = randomUUID();
  const requestedBy = randomUUID();

  function build(
    task: SuggestionTask,
    createdAt: Date,
    overrides: Partial<Suggestion> = {},
  ): Suggestion {
    const outputs: Record<SuggestionTask, Suggestion['output']> = {
      summary: { text: 'Cannot sign in since the reset.', bullets: ['Access'] },
      classification: {
        category: 'access',
        confidence: 0.8,
        rationale: 'password, sign in',
      },
      priority: {
        priority: 'high',
        confidence: 0.5,
        rationale: 'requester is blocked',
      },
      reply: { body: 'Thanks for reporting this.', followUpQuestion: null },
    };
    return {
      id: randomUUID(),
      ticketId,
      task,
      output: outputs[task],
      provider: 'local',
      model: 'heuristics-v1',
      contextHash: 'a'.repeat(64),
      usage: { inputTokens: 120, outputTokens: 40 },
      latencyMs: 12,
      requestedBy,
      createdAt,
      ...overrides,
    };
  }

  beforeEach(async () => {
    await prisma.suggestion.deleteMany();
    logger.warnings.length = 0;
  });

  afterAll(async () => {
    await prisma.suggestion.deleteMany();
    await prisma.$disconnect();
  });

  it('round-trips a suggestion through the Json column', async () => {
    const suggestion = build('summary', new Date('2026-07-29T10:00:00.000Z'));

    await repository.append(suggestion);

    const [stored] = await repository.historyFor(ticketId, 'summary', 10);
    expect(stored).toEqual(suggestion);
  });

  it('stores a suggestion without token usage as null usage', async () => {
    await repository.append(
      build('reply', new Date('2026-07-29T10:00:00.000Z'), { usage: null }),
    );

    const [stored] = await repository.historyFor(ticketId, 'reply', 10);
    expect(stored.usage).toBeNull();
  });

  it('keeps every generation and surfaces the newest per task', async () => {
    const older = build('summary', new Date('2026-07-29T10:00:00.000Z'));
    const newer = build('summary', new Date('2026-07-29T11:00:00.000Z'));
    const other = build('priority', new Date('2026-07-29T10:30:00.000Z'));

    await repository.append(older);
    await repository.append(newer);
    await repository.append(other);

    // Append-only: nothing was overwritten.
    expect(await prisma.suggestion.count()).toBe(3);

    const latest = await repository.latestPerTask(ticketId);
    expect(latest.map((row) => row.id)).toEqual([newer.id, other.id]);
  });

  it('returns one task history newest first, capped by the limit', async () => {
    const times = [
      '2026-07-29T10:00:00.000Z',
      '2026-07-29T11:00:00.000Z',
      '2026-07-29T12:00:00.000Z',
    ].map((value) => new Date(value));
    const rows = times.map((time) => build('classification', time));
    for (const row of rows) {
      await repository.append(row);
    }

    const page = await repository.historyFor(ticketId, 'classification', 2);
    expect(page.map((row) => row.createdAt.toISOString())).toEqual([
      '2026-07-29T12:00:00.000Z',
      '2026-07-29T11:00:00.000Z',
    ]);
  });

  it('ignores other tickets', async () => {
    await repository.append(build('summary', new Date()));
    expect(await repository.latestPerTask(randomUUID())).toEqual([]);
  });

  it('skips and reports a row whose stored output no longer parses', async () => {
    const good = build('summary', new Date('2026-07-29T10:00:00.000Z'));
    await repository.append(good);
    // Simulates a historical row from before the schemas were tightened.
    await prisma.suggestion.create({
      data: {
        id: randomUUID(),
        ticketId,
        task: 'summary',
        output: { text: '' },
        provider: 'local',
        model: 'heuristics-v1',
        contextHash: 'b'.repeat(64),
        inputTokens: null,
        outputTokens: null,
        latencyMs: 5,
        requestedBy,
        createdAt: new Date('2026-07-29T11:00:00.000Z'),
      },
    });

    const history = await repository.historyFor(ticketId, 'summary', 10);

    expect(history.map((row) => row.id)).toEqual([good.id]);
    expect(logger.warnings.join(' ')).toContain('no longer matches its schema');
  });

  it('skips and reports a row whose task is not one this build knows', async () => {
    await prisma.suggestion.create({
      data: {
        id: randomUUID(),
        ticketId,
        task: 'sentiment',
        output: { text: 'whatever' },
        provider: 'local',
        model: 'heuristics-v1',
        contextHash: 'c'.repeat(64),
        inputTokens: null,
        outputTokens: null,
        latencyMs: 5,
        requestedBy,
        createdAt: new Date('2026-07-29T12:00:00.000Z'),
      },
    });

    expect(await repository.latestPerTask(ticketId)).toEqual([]);
    expect(logger.warnings.join(' ')).toContain('unknown task "sentiment"');
  });
});
