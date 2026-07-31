import type { MessagingLogger } from '@helpdesk-ai/messaging';
import type { SuggestionRepository } from '../../application/ports/suggestion.repository';
import {
  isSuggestionTask,
  type Suggestion,
  type SuggestionTask,
} from '../../domain/suggestion';
import { SUGGESTION_OUTPUT_SCHEMAS } from '../../domain/suggestion-outputs';
import type { PrismaService } from './prisma.service';

/** Row shape as Prisma returns it; `output` is Json until validated. */
interface SuggestionRow {
  id: string;
  ticketId: string;
  task: string;
  output: unknown;
  provider: string;
  model: string;
  contextHash: string;
  /** NOT NULL since phase 7, so the type can finally say so. */
  organizationId: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  requestedBy: string;
  createdAt: Date;
}

/**
 * Append-only persistence for suggestions.
 *
 * The port offers no update or delete, and neither does this adapter: the
 * only write is an insert, so history cannot be quietly rewritten.
 */
export class PrismaSuggestionRepository implements SuggestionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger?: MessagingLogger,
  ) {}

  async append(suggestion: Suggestion): Promise<void> {
    await this.prisma.suggestion.create({
      data: {
        id: suggestion.id,
        organizationId: suggestion.organizationId,
        ticketId: suggestion.ticketId,
        task: suggestion.task,
        output: suggestion.output,
        provider: suggestion.provider,
        model: suggestion.model,
        contextHash: suggestion.contextHash,
        inputTokens: suggestion.usage?.inputTokens ?? null,
        outputTokens: suggestion.usage?.outputTokens ?? null,
        latencyMs: suggestion.latencyMs,
        requestedBy: suggestion.requestedBy,
        createdAt: suggestion.createdAt,
      },
    });
  }

  async latestPerTask(ticketId: string): Promise<Suggestion[]> {
    // `distinct` keeps the FIRST row per task in the given order, so the
    // ordering does the selecting: newest per task. `id` breaks ties so the
    // same data always produces the same answer.
    const rows = await this.prisma.suggestion.findMany({
      where: { ticketId },
      orderBy: [{ task: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      distinct: ['task'],
    });

    return this.toDomain(rows).sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  async historyFor(
    ticketId: string,
    task: SuggestionTask,
    limit: number,
  ): Promise<Suggestion[]> {
    const rows = await this.prisma.suggestion.findMany({
      where: { ticketId, task },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return this.toDomain(rows);
  }

  /**
   * Rows are validated on the way out as well as in.
   *
   * Output is written already validated, so a row that no longer parses can
   * only mean the schemas were tightened after it was stored. Such a row is
   * skipped and logged rather than thrown: one historical row must not take
   * down the panel, and a silent skip would hide the schema change.
   */
  private toDomain(rows: SuggestionRow[]): Suggestion[] {
    const suggestions: Suggestion[] = [];
    for (const row of rows) {
      if (!isSuggestionTask(row.task)) {
        this.logger?.warn(
          `skipping suggestion ${row.id}: unknown task "${row.task}"`,
        );
        continue;
      }
      const parsed = SUGGESTION_OUTPUT_SCHEMAS[row.task].safeParse(row.output);
      if (!parsed.success) {
        this.logger?.warn(
          `skipping suggestion ${row.id}: stored ${row.task} output no longer matches its schema`,
        );
        continue;
      }
      suggestions.push({
        id: row.id,
        organizationId: row.organizationId,
        ticketId: row.ticketId,
        task: row.task,
        output: parsed.data,
        provider: row.provider,
        model: row.model,
        contextHash: row.contextHash,
        usage:
          row.inputTokens === null || row.outputTokens === null
            ? null
            : { inputTokens: row.inputTokens, outputTokens: row.outputTokens },
        latencyMs: row.latencyMs,
        requestedBy: row.requestedBy,
        createdAt: row.createdAt,
      });
    }
    return suggestions;
  }
}
