import { Controller, Get, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  JwtAccessGuard,
  type AccessTokenPayload,
  type Actor,
} from '@helpdesk-ai/security';
import { GetAnalyticsSummaryUseCase } from '../../application/use-cases/get-summary';
import type { AnalyticsSummary } from '../../domain/analytics';
import { AnalyticsDomainErrorFilter } from './analytics-domain-error.filter';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return { id: req.user.sub, roles: req.user.roles };
}

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAccessGuard)
@UseFilters(AnalyticsDomainErrorFilter)
export class AnalyticsController {
  constructor(private readonly getSummary: GetAnalyticsSummaryUseCase) {}

  @Get('summary')
  @ApiOperation({ summary: 'Desk-wide dashboard aggregates (staff only)' })
  async summary(@Req() req: AuthenticatedRequest): Promise<AnalyticsSummary> {
    return this.getSummary.execute(actorOf(req));
  }
}
