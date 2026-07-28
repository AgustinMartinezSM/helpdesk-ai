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
import type { Actor } from '../../domain/ticket';
import { AddCommentUseCase } from '../../application/use-cases/add-comment';
import { CreateTicketUseCase } from '../../application/use-cases/create-ticket';
import {
  GetTicketUseCase,
  ListTicketsUseCase,
} from '../../application/use-cases/ticket-queries';
import {
  AssignTicketUseCase,
  ChangeTicketStatusUseCase,
} from '../../application/use-cases/ticket-lifecycle';
import {
  JwtAccessGuard,
  type AccessTokenPayload,
} from '../guards/jwt-access.guard';
import {
  AddCommentDto,
  AssignTicketDto,
  ChangeStatusDto,
  CreateTicketDto,
  ListTicketsQueryDto,
} from './dto';
import { TicketDomainErrorFilter } from './ticket-domain-error.filter';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return { id: req.user.sub, roles: req.user.roles };
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
    private readonly assignTicket: AssignTicketUseCase,
    private readonly addComment: AddCommentUseCase,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Open a ticket as the authenticated user' })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateTicketDto) {
    return this.createTicket.execute(actorOf(req), dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List tickets (requesters see only their own)',
  })
  list(@Req() req: AuthenticatedRequest, @Query() query: ListTicketsQueryDto) {
    return this.listTickets.execute(actorOf(req), query);
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
    return this.changeStatus.execute(actorOf(req), id, dto.status);
  }

  @Patch(':id/assignee')
  @ApiOperation({ summary: 'Assign or unassign the ticket (staff only)' })
  assign(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignTicketDto,
  ) {
    return this.assignTicket.execute(actorOf(req), id, dto.assigneeId);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Comment on the ticket (internal = staff only)' })
  comment(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCommentDto,
  ) {
    return this.addComment.execute(actorOf(req), id, dto);
  }
}
