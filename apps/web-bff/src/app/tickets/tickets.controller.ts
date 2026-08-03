import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Patch,
  Post,
  Query,
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
 * Browser-facing tickets endpoints: thin pass-through to the gateway.
 *
 * The BFF adds what the browser needs — one origin, credentialed CORS,
 * correlation — and forwards the caller's bearer token untouched. Domain
 * validation deliberately stays in tickets-service: duplicating DTO rules
 * here would just let the two drift apart.
 */
@Controller('tickets')
export class TicketsController {
  constructor(
    @Inject(GATEWAY_CLIENT) private readonly gateway: GatewayClient,
  ) {}

  @Get()
  list(
    @Req() req: BrowserRequest,
    @Query('status') status?: string,
    @Query('branchId') branchId?: string,
    @Query('assignedTeamId') assignedTeamId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ): Promise<unknown> {
    // Named one by one rather than passed through wholesale: the upstream
    // runs `forbidNonWhitelisted`, so an unknown parameter arriving from a
    // stale page would turn a listing into a 400.
    const query = new URLSearchParams();
    if (status) query.set('status', status);
    if (branchId) query.set('branchId', branchId);
    if (assignedTeamId) query.set('assignedTeamId', assignedTeamId);
    if (skip) query.set('skip', skip);
    if (take) query.set('take', take);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.forward(req, 'GET', `/api/tickets${suffix}`);
  }

  // Declared before ':id' — Nest matches in declaration order, and a
  // literal 'branches' segment after ':id' would be parsed as a ticket id.
  @Get('branches')
  branches(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(req, 'GET', '/api/tickets/branches');
  }

  @Get('branches/:branchId/stations')
  stations(
    @Req() req: BrowserRequest,
    @Param('branchId') branchId: string,
  ): Promise<unknown> {
    return this.forward(
      req,
      'GET',
      `/api/tickets/branches/${encodeURIComponent(branchId)}/stations`,
    );
  }

  @Get(':id')
  get(@Req() req: BrowserRequest, @Param('id') id: string): Promise<unknown> {
    return this.forward(req, 'GET', `/api/tickets/${encodeURIComponent(id)}`);
  }

  @Post()
  create(@Req() req: BrowserRequest, @Body() body: unknown): Promise<unknown> {
    return this.forward(req, 'POST', '/api/tickets', body);
  }

  @Patch(':id/status')
  status(
    @Req() req: BrowserRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/tickets/${encodeURIComponent(id)}/status`,
      body,
    );
  }

  @Patch(':id/assignee')
  assign(
    @Req() req: BrowserRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/tickets/${encodeURIComponent(id)}/assignee`,
      body,
    );
  }

  @Patch(':id/team')
  route(
    @Req() req: BrowserRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    // Routing a ticket to the support team that should resolve it. The
    // upstream's generic 422 — archived, foreign, out of scope, or a
    // branchless ticket sent to a scoped team — arrives here as one answer
    // and leaves as one answer.
    return this.forward(
      req,
      'PATCH',
      `/api/tickets/${encodeURIComponent(id)}/team`,
      body,
    );
  }

  @Post(':id/comments')
  comment(
    @Req() req: BrowserRequest,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'POST',
      `/api/tickets/${encodeURIComponent(id)}/comments`,
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
