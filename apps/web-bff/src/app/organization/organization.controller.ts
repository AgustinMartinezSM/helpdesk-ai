import {
  Body,
  Controller,
  Get,
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
 */
@Controller('organization')
export class OrganizationController {
  constructor(
    @Inject(GATEWAY_CLIENT) private readonly gateway: GatewayClient,
  ) {}

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
