import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
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
 * Browser-facing AI endpoints: thin pass-through to the gateway.
 *
 * No policy lives here. ai-service is the one place that decides who may
 * ask for a suggestion and what a valid answer is; duplicating either here
 * would only create a second version to keep in sync.
 */
@Controller('ai')
export class AiController {
  constructor(
    @Inject(GATEWAY_CLIENT) private readonly gateway: GatewayClient,
  ) {}

  @Get('provider')
  provider(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(req, 'GET', '/api/ai/provider');
  }

  @Get('tickets/:ticketId/suggestions')
  latest(
    @Req() req: BrowserRequest,
    @Param('ticketId') ticketId: string,
  ): Promise<unknown> {
    return this.forward(
      req,
      'GET',
      `/api/ai/tickets/${encodeURIComponent(ticketId)}/suggestions`,
    );
  }

  @Post('tickets/:ticketId/suggestions')
  generate(
    @Req() req: BrowserRequest,
    @Param('ticketId') ticketId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'POST',
      `/api/ai/tickets/${encodeURIComponent(ticketId)}/suggestions`,
      body,
    );
  }

  @Get('tickets/:ticketId/suggestions/:task')
  history(
    @Req() req: BrowserRequest,
    @Param('ticketId') ticketId: string,
    @Param('task') task: string,
  ): Promise<unknown> {
    return this.forward(
      req,
      'GET',
      `/api/ai/tickets/${encodeURIComponent(ticketId)}/suggestions/${encodeURIComponent(task)}`,
    );
  }

  private async forward(
    req: BrowserRequest,
    method: 'GET' | 'POST',
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
