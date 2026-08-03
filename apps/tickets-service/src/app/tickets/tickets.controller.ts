import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TRACE_ID_HEADER } from '@helpdesk-ai/observability';
import { AddCommentUseCase } from '../../application/use-cases/add-comment';
import { CreateTicketUseCase } from '../../application/use-cases/create-ticket';
import {
  GetTicketUseCase,
  ListTicketsUseCase,
} from '../../application/use-cases/ticket-queries';
import {
  ListBranchesForPickerUseCase,
  ListStationsForPickerUseCase,
} from '../../application/use-cases/structure-pickers';
import {
  AssignTicketUseCase,
  ChangeTicketStatusUseCase,
} from '../../application/use-cases/ticket-lifecycle';
import {
  JwtAccessGuard,
  type AccessTokenPayload,
  type Actor,
} from '@helpdesk-ai/security';
import {
  AddCommentDto,
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  ListTicketsQueryDto,
  RouteTicketDto,
} from './dto';
import { RouteTicketUseCase } from '../../application/use-cases/route-ticket';
import { TicketDomainErrorFilter } from './ticket-domain-error.filter';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
  headers: Record<string, string | string[] | undefined>;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return {
    id: req.user.sub,
    // Undefined whenever the token was minted without a tenant. Read here
    // rather than decoded anywhere else: the guard already verified this
    // token, and a second place that decides what a valid token looks like
    // is a second place that can be wrong.
    organizationId: req.user.org,
    // Absent claim -> empty set: an old token loses capabilities rather
    // than gaining them.
    permissions: new Set(req.user.perms ?? []),
    // Undefined, not an empty set, when the claim is absent: Actor keeps
    // the difference visible, and both deny branch-scoped visibility — an
    // old token loses scope rather than gaining it (D2).
    branchIds: req.user.br ? new Set(req.user.br) : undefined,
    // Absent stays undefined rather than becoming an empty set: absence
    // denies, and an empty set would read as a decision nobody made.
    teamIds: req.user.tm ? new Set(req.user.tm) : undefined,
  };
}

/**
 * The trace id of the request that is about to cause a domain event.
 * `correlationMiddleware` guarantees the header exists on every inbound
 * request, so the undefined branch only covers a caller that bypassed it.
 */
function traceIdOf(req: AuthenticatedRequest): string | undefined {
  const value = req.headers[TRACE_ID_HEADER];
  return Array.isArray(value) ? value[0] : value;
}

@ApiTags('tickets')
@ApiBearerAuth()
@Controller('tickets')
@UseGuards(JwtAccessGuard)
@UseFilters(TicketDomainErrorFilter)
export class TicketsController {
  constructor(
    private readonly createTicket: CreateTicketUseCase,
    private readonly getTicket: GetTicketUseCase,
    private readonly listTickets: ListTicketsUseCase,
    private readonly changeStatus: ChangeTicketStatusUseCase,
    private readonly routeTicket: RouteTicketUseCase,
    private readonly assignTicket: AssignTicketUseCase,
    private readonly addComment: AddCommentUseCase,
    private readonly listBranches: ListBranchesForPickerUseCase,
    private readonly listStations: ListStationsForPickerUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Open a ticket as the authenticated user' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTicketDto) {
    return this.createTicket.execute(actorOf(req), dto, traceIdOf(req));
  }

  @Get()
  @ApiOperation({
    summary: 'List tickets (requesters see only their own)',
  })
  list(@Req() req: AuthenticatedRequest, @Query() query: ListTicketsQueryDto) {
    return this.listTickets.execute(actorOf(req), query);
  }

  // The picker routes are declared BEFORE ':id' on purpose: Nest matches
  // routes in declaration order, so a literal 'branches' segment declared
  // after @Get(':id') would be captured as a ticket id and answer 400.

  @Get('branches')
  @ApiOperation({
    summary: "Active branches of the caller's organization (picker)",
  })
  branches(@Req() req: AuthenticatedRequest) {
    return this.listBranches.execute(actorOf(req));
  }

  @Get('branches/:branchId/stations')
  @ApiOperation({ summary: "Active stations of one of the caller's branches" })
  stations(
    @Req() req: AuthenticatedRequest,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.listStations.execute(actorOf(req), branchId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ticket with comments and history' })
  get(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.getTicket.execute(actorOf(req), id);
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Move the ticket through its lifecycle' })
  status(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
  ) {
    return this.changeStatus.execute(
      actorOf(req),
      id,
      dto.status,
      traceIdOf(req),
    );
  }

  @Patch(':id/assignee')
  @ApiOperation({ summary: 'Assign or unassign the ticket (staff only)' })
  assign(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.assignTicket.execute(
      actorOf(req),
      id,
      dto.assigneeId,
      traceIdOf(req),
    );
  }

  @Patch(':id/team')
  @ApiOperation({
    summary: 'Route the ticket to a support team, or clear it (routing.manage)',
  })
  route(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RouteTicketDto,
  ) {
    return this.routeTicket.execute(actorOf(req), {
      ticketId: id,
      teamId: dto.teamId ?? null,
    });
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Comment on the ticket (internal = staff only)' })
  comment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.addComment.execute(actorOf(req), id, dto, traceIdOf(req));
  }
}
