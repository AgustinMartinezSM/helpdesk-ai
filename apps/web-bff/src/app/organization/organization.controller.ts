import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { REQUEST_ID_HEADER, TRACE_ID_HEADER } from '@helpdesk-ai/observability';
import {
  GATEWAY_CLIENT,
  GatewayClient,
  type CorrelationHeaders,
  type UpstreamResponse,
} from '../gateway.client';

interface BrowserRequest {
  headers: Record<string, string | undefined>;
}

/**
 * Browser-facing organization setup: branches and what is inside them.
 *
 * Thin pass-through, no policy — the same rule the people, ticket and AI
 * controllers follow. organizations-service decides who may register a
 * branch, who may edit one, and what every refusal means; a check here would
 * be a second place to keep in sync and the first place to get it wrong.
 *
 * `GET /organization/branches` is also what the People screen's branch editor
 * reads. It lived under `/people` in Sprint 9.10, when that editor was its
 * only caller; one door per upstream resource is worth more than a prefix
 * that matches whichever screen asked first.
 *
 * Sprint 9.13 added the support-team paths for the same reason and with the
 * same discipline: `teams/mine` needs no permission upstream while everything
 * else needs `teams.manage`, and knowing which is which is not this layer's
 * business.
 */
@Controller('organization')
export class OrganizationController {
  constructor(
    @Inject(GATEWAY_CLIENT) private readonly gateway: GatewayClient,
  ) {}

  /**
   * Creating the organization itself. Sprint 10.4, and the only route here
   * whose caller does NOT yet belong to an organization — which changes
   * nothing at this layer, because this layer has never decided access.
   */
  @Post()
  create(@Req() req: BrowserRequest, @Body() body: unknown): Promise<unknown> {
    return this.forward(req, 'POST', '/api/organizations', body);
  }

  /*
   * The organization itself (Sprint 10.5). Before ':branchId' and every other
   * parameterised path below, though nothing here is parameterised today —
   * `current` is a literal segment and keeping the literal routes first is the
   * habit that stopped `teams/mine` being read as a team id.
   */

  @Get('current')
  current(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(req, 'GET', '/api/organizations/current');
  }

  @Patch('current')
  rename(@Req() req: BrowserRequest, @Body() body: unknown): Promise<unknown> {
    return this.forward(req, 'PATCH', '/api/organizations/current', body);
  }

  /**
   * Handing the organization on. Upstream decides who may — from the caller's
   * stored membership, which this layer could not read and must not try to
   * approximate from the token it is forwarding.
   */
  @Post('ownership/transfer')
  // 200, not the framework's 201: nothing is created — two memberships change
  // template. The upstream route says the same thing, and a BFF answering 201
  // would be the protocol lying where the copy does not, which is the mistake
  // the import preview made and Sprint 9.15 corrected.
  @HttpCode(200)
  transferOwnership(
    @Req() req: BrowserRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'POST',
      '/api/organizations/ownership/transfer',
      body,
    );
  }

  @Get('branches')
  branches(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(req, 'GET', '/api/organizations/branches');
  }

  @Post('branches')
  createBranch(
    @Req() req: BrowserRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(req, 'POST', '/api/organizations/branches', body);
  }

  @Patch('branches/:branchId')
  updateBranch(
    @Req() req: BrowserRequest,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/branches/${encodeURIComponent(branchId)}`,
      body,
    );
  }

  @Get('branches/:branchId/structure')
  structure(
    @Req() req: BrowserRequest,
    @Param('branchId') branchId: string,
  ): Promise<unknown> {
    return this.forward(
      req,
      'GET',
      `/api/organizations/branches/${encodeURIComponent(branchId)}/structure`,
    );
  }

  @Post('branches/:branchId/departments')
  createDepartment(
    @Req() req: BrowserRequest,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'POST',
      `/api/organizations/branches/${encodeURIComponent(branchId)}/departments`,
      body,
    );
  }

  @Post('branches/:branchId/stations')
  createStation(
    @Req() req: BrowserRequest,
    @Param('branchId') branchId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'POST',
      `/api/organizations/branches/${encodeURIComponent(branchId)}/stations`,
      body,
    );
  }

  @Patch('departments/:departmentId')
  updateDepartment(
    @Req() req: BrowserRequest,
    @Param('departmentId') departmentId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/departments/${encodeURIComponent(departmentId)}`,
      body,
    );
  }

  @Patch('stations/:stationId')
  updateStation(
    @Req() req: BrowserRequest,
    @Param('stationId') stationId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/stations/${encodeURIComponent(stationId)}`,
      body,
    );
  }

  /*
   * Support teams (Sprint 9.13). They sit under /organization because they
   * are organization-owned setup, next to branches — but a team is NOT a
   * department and none of these paths goes anywhere near one. Whose
   * department somebody works in says nothing about which tickets they
   * resolve (ADR 0022).
   */

  @Get('teams')
  teams(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(req, 'GET', '/api/organizations/teams');
  }

  // Before ':teamId', matching the upstream declaration order: 'mine' is a
  // literal segment, not a team id.
  @Get('teams/mine')
  myTeams(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(req, 'GET', '/api/organizations/teams/mine');
  }

  @Post('teams')
  createTeam(
    @Req() req: BrowserRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(req, 'POST', '/api/organizations/teams', body);
  }

  @Get('teams/:teamId')
  team(
    @Req() req: BrowserRequest,
    @Param('teamId') teamId: string,
  ): Promise<unknown> {
    return this.forward(
      req,
      'GET',
      `/api/organizations/teams/${encodeURIComponent(teamId)}`,
    );
  }

  @Patch('teams/:teamId')
  updateTeam(
    @Req() req: BrowserRequest,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/teams/${encodeURIComponent(teamId)}`,
      body,
    );
  }

  @Patch('teams/:teamId/members')
  setTeamMembers(
    @Req() req: BrowserRequest,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/teams/${encodeURIComponent(teamId)}/members`,
      body,
    );
  }

  @Patch('teams/:teamId/branches')
  setTeamScope(
    @Req() req: BrowserRequest,
    @Param('teamId') teamId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    // The body's empty array is meaningful — it makes the team
    // organization-wide — and forwarding it unshaped is what preserves that.
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/teams/${encodeURIComponent(teamId)}/branches`,
      body,
    );
  }

  private async forward(
    req: BrowserRequest,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    const upstream: UpstreamResponse = await this.gateway.request(
      method,
      path,
      {
        correlation: correlationOf(req),
        authorization: req.headers.authorization,
        body,
      },
    );
    if (upstream.status < 200 || upstream.status >= 300) {
      throw new HttpException(
        upstream.body ?? { statusCode: upstream.status },
        upstream.status,
      );
    }
    return upstream.body;
  }
}

function correlationOf(req: BrowserRequest): CorrelationHeaders {
  const headers: CorrelationHeaders = {};
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
