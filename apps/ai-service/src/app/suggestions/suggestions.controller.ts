import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { REQUEST_ID_HEADER, TRACE_ID_HEADER } from '@helpdesk-ai/observability';
import {
  JwtAccessGuard,
  type AccessTokenPayload,
  type Actor,
} from '@helpdesk-ai/security';
import {
  AI_PROVIDER,
  type AiProvider,
} from '../../application/ports/ai-provider';
import type { CorrelationHeaders } from '../../application/ports/ticket-source';
import { GenerateSuggestionUseCase } from '../../application/use-cases/generate-suggestion';
import {
  GetSuggestionHistoryUseCase,
  ListSuggestionsUseCase,
} from '../../application/use-cases/suggestion-queries';
import {
  isSuggestionTask,
  SUGGESTION_TASKS,
  type Suggestion,
  type SuggestionOutput,
  type SuggestionTask,
} from '../../domain/suggestion';
import { GenerateSuggestionDto } from './dto/generate-suggestion.dto';
import { HistoryQueryDto } from './dto/history-query.dto';
import { AiDomainErrorFilter } from './ai-domain-error.filter';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
  headers: Record<string, string | undefined>;
}

const BEARER_PREFIX = 'Bearer ';

function actorOf(req: AuthenticatedRequest): Actor {
  return {
    id: req.user.sub,
    roles: req.user.roles,
    // Undefined whenever the token was minted without a tenant. Taken from
    // the payload the guard already verified — the same reason the bearer
    // header below is re-read rather than decoded again.
    organizationId: req.user.org,
  };
}

/**
 * The caller's own token, which this service forwards to tickets-service
 * (ADR 0011). The guard already verified it; this only re-reads the header
 * it verified, so there is no second place that decides what a valid token
 * looks like.
 */
function accessTokenOf(req: AuthenticatedRequest): string {
  const header = req.headers.authorization;
  if (!header?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedException();
  }
  return header.slice(BEARER_PREFIX.length);
}

function correlationOf(req: AuthenticatedRequest): CorrelationHeaders {
  const headers: Record<string, string> = {};
  const requestId = req.headers[REQUEST_ID_HEADER];
  const traceId = req.headers[TRACE_ID_HEADER];
  if (requestId) {
    headers[REQUEST_ID_HEADER] = requestId;
  }
  if (traceId) {
    headers[TRACE_ID_HEADER] = traceId;
  }
  return headers;
}

/** Wire shape: dates travel as ISO strings. */
interface SuggestionResponse {
  id: string;
  ticketId: string;
  task: SuggestionTask;
  output: SuggestionOutput;
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
  latencyMs: number;
  contextHash: string;
  requestedBy: string;
  createdAt: string;
}

function toResponse(suggestion: Suggestion): SuggestionResponse {
  return {
    id: suggestion.id,
    ticketId: suggestion.ticketId,
    task: suggestion.task,
    output: suggestion.output,
    provider: suggestion.provider,
    model: suggestion.model,
    usage: suggestion.usage,
    latencyMs: suggestion.latencyMs,
    contextHash: suggestion.contextHash,
    requestedBy: suggestion.requestedBy,
    createdAt: suggestion.createdAt.toISOString(),
  };
}

/**
 * Staff-only AI surface. Every route is authenticated, and the use cases
 * refuse non-staff callers themselves — the guard proves who you are, the
 * application layer decides what that allows.
 */
@ApiTags('ai')
@ApiBearerAuth()
@Controller('ai')
@UseGuards(JwtAccessGuard)
@UseFilters(AiDomainErrorFilter)
export class SuggestionsController {
  constructor(
    private readonly generate: GenerateSuggestionUseCase,
    private readonly list: ListSuggestionsUseCase,
    private readonly history: GetSuggestionHistoryUseCase,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
  ) {}

  @Get('provider')
  @ApiOperation({
    summary: 'Which provider and model answer here (for honest labeling)',
  })
  currentProvider(): { id: string; model: string } {
    return { id: this.provider.id, model: this.provider.model };
  }

  @Post('tickets/:ticketId/suggestions')
  @ApiOperation({
    summary: 'Generate one suggestion for a ticket (staff only)',
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Body() dto: GenerateSuggestionDto,
  ): Promise<SuggestionResponse> {
    const suggestion = await this.generate.execute(actorOf(req), {
      ticketId,
      task: dto.task,
      accessToken: accessTokenOf(req),
      correlation: correlationOf(req),
    });
    return toResponse(suggestion);
  }

  @Get('tickets/:ticketId/suggestions')
  @ApiOperation({
    summary: 'Newest suggestion per task for a ticket (staff only)',
  })
  async latest(
    @Req() req: AuthenticatedRequest,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
  ): Promise<SuggestionResponse[]> {
    const suggestions = await this.list.execute(actorOf(req), ticketId);
    return suggestions.map(toResponse);
  }

  @Get('tickets/:ticketId/suggestions/:task')
  @ApiOperation({
    summary: 'Every suggestion recorded for one task, newest first',
  })
  async taskHistory(
    @Req() req: AuthenticatedRequest,
    @Param('ticketId', ParseUUIDPipe) ticketId: string,
    @Param('task') task: string,
    @Query() query: HistoryQueryDto,
  ): Promise<SuggestionResponse[]> {
    if (!isSuggestionTask(task)) {
      // A path segment has no DTO to validate it, so the check lives here.
      // Rejecting is better than answering with an empty list, which would
      // read as "this task exists and has no history".
      throw new BadRequestException(
        `unknown task "${task}"; expected one of ${SUGGESTION_TASKS.join(', ')}`,
      );
    }
    const suggestions = await this.history.execute(
      actorOf(req),
      ticketId,
      task,
      query.limit,
    );
    return suggestions.map(toResponse);
  }
}
