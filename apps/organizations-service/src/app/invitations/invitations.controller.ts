import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
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
import { AcceptInvitationUseCase } from '../../application/use-cases/accept-invitation';
import { IssueInvitationUseCase } from '../../application/use-cases/issue-invitation';
import {
  ListInvitationsUseCase,
  toView,
  type InvitationView,
} from '../../application/use-cases/list-invitations';
import { RevokeInvitationUseCase } from '../../application/use-cases/revoke-invitation';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';
import {
  AcceptInvitationDto,
  CreateInvitationDto,
  ListInvitationsQueryDto,
} from './dto';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return {
    id: req.user.sub,
    // Undefined on a token minted without a tenant — a real state (ADR 0014),
    // and exactly the state the accept route below expects. Read from the
    // payload the guard already verified; no second decoding.
    organizationId: req.user.org,
    permissions: new Set(req.user.perms ?? []),
  };
}

interface IssuedInvitationResponse extends InvitationView {
  /**
   * The one and only time this value appears anywhere. It is not stored, not
   * logged, not published in an event, and cannot be recovered — if the admin
   * loses it, the invitation is revoked and a new one issued.
   */
  code: string;
}

interface AcceptedInvitationResponse {
  organizationId: string;
  roleTemplate: string;
  /**
   * False when the person already belonged to the organization: the
   * invitation is consumed, their existing membership is left exactly as it
   * was, and no role is silently rewritten.
   */
  membershipCreated: boolean;
}

/**
 * The first person-facing surface this service has ever had (ADR 0019).
 *
 * Everything here goes through JwtAccessGuard; the /internal/* controllers
 * keep InternalServiceGuard and their own credential, which is why the guard
 * is applied per controller rather than globally. The api-gateway strips
 * `x-internal-service-token` from inbound requests, so nothing reaching this
 * host from outside can present the process credential.
 */
@ApiTags('invitations')
@ApiBearerAuth()
@Controller('organizations/invitations')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class InvitationsController {
  constructor(
    private readonly issueInvitation: IssueInvitationUseCase,
    private readonly listInvitations: ListInvitationsUseCase,
    private readonly revokeInvitation: RevokeInvitationUseCase,
    private readonly acceptInvitation: AcceptInvitationUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Issue an invitation. The response carries the code once.',
  })
  async issue(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateInvitationDto,
  ): Promise<IssuedInvitationResponse> {
    const issued = await this.issueInvitation.execute(actorOf(req), {
      inviteeEmail: dto.inviteeEmail,
      roleTemplate: dto.roleTemplate,
    });
    return {
      ...toView(issued.invitation, issued.invitation.createdAt),
      code: issued.code,
    };
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListInvitationsQueryDto,
  ): Promise<InvitationView[]> {
    return this.listInvitations.execute(actorOf(req), {
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });
  }

  /**
   * Declared BEFORE the ':invitationId' route below. Nest matches in
   * declaration order, and while these two happen not to collide today
   * (different depths), the ordering is the habit tickets-service's
   * GET /tickets/branches had to learn — a later sibling route with one
   * segment would silently swallow 'accept'.
   */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Redeem an invitation as the signed-in, addressed person.',
  })
  async accept(
    @Req() req: AuthenticatedRequest,
    @Body() dto: AcceptInvitationDto,
  ): Promise<AcceptedInvitationResponse> {
    const accepted = await this.acceptInvitation.execute(actorOf(req), {
      code: dto.code,
      // From the VERIFIED claim, never from the body: a body field would let
      // whoever holds a leaked code decide who they are.
      actorEmail: req.user.email,
    });
    return {
      organizationId: accepted.membership.organizationId,
      roleTemplate: accepted.membership.roleTemplate,
      membershipCreated: accepted.membershipCreated,
    };
  }

  /**
   * POST rather than DELETE: the row is kept as the record that someone was
   * invited and the offer was withdrawn, and web-bff's GatewayClient speaks
   * only GET/POST/PATCH, so this stays reachable when the UI sprint arrives.
   */
  @Post(':invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(
    @Req() req: AuthenticatedRequest,
    @Param('invitationId', new ParseUUIDPipe()) invitationId: string,
  ): Promise<InvitationView> {
    const revoked = await this.revokeInvitation.execute(
      actorOf(req),
      invitationId,
    );
    return toView(revoked, revoked.updatedAt);
  }
}
