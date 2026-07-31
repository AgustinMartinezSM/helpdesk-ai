import {
  Controller,
  Get,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  JwtAccessGuard,
  type AccessTokenPayload,
  type Actor,
} from '@helpdesk-ai/security';
import { ListAuditEventsUseCase } from '../../application/use-cases/list-audit-events';
import type { AuditEvent } from '../../domain/audit-event';
import { AuditDomainErrorFilter } from './audit-domain-error.filter';
import { ListAuditQueryDto } from './dto/list-audit-query.dto';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return {
    id: req.user.sub,
    roles: req.user.roles,
    // Both undefined/empty on a token minted without a tenant. Read from the
    // payload the guard already verified — no second decoding.
    organizationId: req.user.org,
    permissions: new Set(req.user.perms ?? []),
  };
}

/** Wire shape: dates travel as ISO strings, payload stays as recorded. */
interface AuditEventResponse {
  id: string;
  type: string;
  occurredAt: string;
  correlationId: string | null;
  payload: unknown;
  recordedAt: string;
}

function toResponse(event: AuditEvent): AuditEventResponse {
  return {
    id: event.id,
    type: event.type,
    occurredAt: event.occurredAt.toISOString(),
    correlationId: event.correlationId,
    payload: event.payload,
    recordedAt: event.recordedAt.toISOString(),
  };
}

@ApiTags('audit')
@ApiBearerAuth()
@Controller('audit')
@UseGuards(JwtAccessGuard)
@UseFilters(AuditDomainErrorFilter)
export class AuditController {
  constructor(private readonly listEvents: ListAuditEventsUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Recorded domain events, newest first (admin only)',
  })
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListAuditQueryDto,
  ): Promise<AuditEventResponse[]> {
    const events = await this.listEvents.execute(actorOf(req), {
      type: query.type,
      limit: query.limit,
      offset: query.offset,
    });
    return events.map(toResponse);
  }
}
