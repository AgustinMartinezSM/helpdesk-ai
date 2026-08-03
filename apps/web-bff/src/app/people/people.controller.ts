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
 * Browser-facing people endpoints: the directory and profiles from
 * users-service, invitations from organizations-service.
 *
 * Thin pass-through, no policy — the same rule the AI and ticket controllers
 * follow. The two domain services decide who may read a directory, who may
 * invite, and what every refusal means; a check here would be a second place
 * to keep in sync and the first place to get it wrong. That includes the
 * refusals: a 403 or a 404 is forwarded exactly as the service shaped it,
 * because the 404-not-403 rules ARE the security design (a 403 on a foreign
 * id would confirm it exists).
 *
 * One controller for two upstreams because one screen consumes both, and the
 * browser should not have to know which service owns which half.
 */
@Controller('people')
export class PeopleController {
  constructor(
    @Inject(GATEWAY_CLIENT) private readonly gateway: GatewayClient,
  ) {}

  /** The organization's members; ?status=all includes suspended and removed. */
  @Get()
  directory(
    @Req() req: BrowserRequest,
    @Query('status') status?: string,
  ): Promise<unknown> {
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.forward(req, 'GET', `/api/users${query}`);
  }

  /**
   * Active members as candidates, for a picker. A narrower upstream than the
   * directory above and gated on a narrower key — which is the whole point of
   * it existing (Sprint 9.14).
   */
  @Get('assignable')
  assignable(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(req, 'GET', '/api/users/assignable');
  }

  /**
   * Role templates the CALLER may grant. Answered per actor upstream, which
   * is why the invite form can no longer offer a choice that gets refused on
   * submit (Sprint 9.14).
   */
  @Get('role-templates')
  grantableRoleTemplates(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(
      req,
      'GET',
      '/api/organizations/memberships/role-templates',
    );
  }

  @Get('me')
  myProfile(@Req() req: BrowserRequest): Promise<unknown> {
    return this.forward(req, 'GET', '/api/users/me');
  }

  @Patch('me')
  updateMyProfile(
    @Req() req: BrowserRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(req, 'PATCH', '/api/users/me', body);
  }

  @Get('invitations')
  listInvitations(
    @Req() req: BrowserRequest,
    @Query('status') status?: string,
  ): Promise<unknown> {
    // Only `status` is forwarded. limit/offset exist upstream but nothing in
    // the UI pages yet, and forwarding a parameter no screen sets would be a
    // surface with no caller.
    const query = status ? `?status=${encodeURIComponent(status)}` : '';
    return this.forward(req, 'GET', `/api/organizations/invitations${query}`);
  }

  @Post('invitations')
  issueInvitation(
    @Req() req: BrowserRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    // The response carries the one-time code. It passes through untouched and
    // is not logged here, exactly as it is not logged anywhere else.
    return this.forward(req, 'POST', '/api/organizations/invitations', body);
  }

  @Post('invitations/preview')
  @HttpCode(200)
  previewInvitation(
    @Req() req: BrowserRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'POST',
      '/api/organizations/invitations/preview',
      body,
    );
  }

  @Post('invitations/accept')
  @HttpCode(200)
  acceptInvitation(
    @Req() req: BrowserRequest,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'POST',
      '/api/organizations/invitations/accept',
      body,
    );
  }

  /**
   * Declared after 'invitations/preview' and 'invitations/accept': Nest
   * matches in declaration order, and ':invitationId' would otherwise swallow
   * both literals.
   */
  @Post('invitations/:invitationId/revoke')
  @HttpCode(200)
  revokeInvitation(
    @Req() req: BrowserRequest,
    @Param('invitationId') invitationId: string,
  ): Promise<unknown> {
    return this.forward(
      req,
      'POST',
      `/api/organizations/invitations/${encodeURIComponent(invitationId)}/revoke`,
    );
  }

  // The branch picker's source lived here in Sprint 9.10; it moved to the
  // organization controller in 9.11, next to the writes for the same noun.

  // Member administration (Sprint 9.10). Still no policy here: which of these
  // a caller may perform is three separate permission keys, all checked in
  // organizations-service, and the refusals pass through untouched.

  @Patch(':userId/role')
  changeRole(
    @Req() req: BrowserRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/memberships/${encodeURIComponent(userId)}/role`,
      body,
    );
  }

  @Patch(':userId/status')
  changeStatus(
    @Req() req: BrowserRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/memberships/${encodeURIComponent(userId)}/status`,
      body,
    );
  }

  @Get(':userId/branches')
  memberBranches(
    @Req() req: BrowserRequest,
    @Param('userId') userId: string,
  ): Promise<unknown> {
    return this.forward(
      req,
      'GET',
      `/api/organizations/memberships/${encodeURIComponent(userId)}/branches`,
    );
  }

  @Patch(':userId/branches')
  setMemberBranches(
    @Req() req: BrowserRequest,
    @Param('userId') userId: string,
    @Body() body: unknown,
  ): Promise<unknown> {
    return this.forward(
      req,
      'PATCH',
      `/api/organizations/memberships/${encodeURIComponent(userId)}/branches`,
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
