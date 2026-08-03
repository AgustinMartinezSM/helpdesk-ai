import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import type { SupportTeam } from '../../domain/support-team';
import {
  CreateSupportTeamUseCase,
  GetSupportTeamUseCase,
  ListMySupportTeamsUseCase,
  ListSupportTeamsUseCase,
  SetSupportTeamMembersUseCase,
  SetSupportTeamScopeUseCase,
  UpdateSupportTeamUseCase,
} from '../../application/use-cases/support-teams';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';
import {
  CreateSupportTeamDto,
  SetSupportTeamMembersDto,
  SetSupportTeamScopeDto,
  UpdateSupportTeamDto,
} from './dto';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return {
    id: req.user.sub,
    organizationId: req.user.org,
    permissions: new Set(req.user.perms ?? []),
  };
}

interface SupportTeamResponse {
  teamId: string;
  code: string;
  name: string;
  status: string;
}

interface SupportTeamDetailResponse extends SupportTeamResponse {
  /** User ids, not membership ids. */
  memberUserIds: string[];
  /** EMPTY MEANS ORGANIZATION-WIDE, not "serves nothing". */
  branchIds: string[];
}

/**
 * Support teams: the groups that resolve tickets (Sprint 9.12, ADR 0022).
 *
 * A support team is NOT a department. A department is the requester's
 * organizational area and belongs to one branch; a team is organization-owned
 * and its branch reach is the separate scope below, which is what lets one
 * central team serve every store.
 *
 * The tenant comes from the token and appears in no route, the rule Sprint
 * 9.11 established for the whole public surface.
 */
@ApiTags('support-teams')
@ApiBearerAuth()
@Controller('organizations/teams')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class SupportTeamsController {
  constructor(
    private readonly listTeams: ListSupportTeamsUseCase,
    private readonly myTeams: ListMySupportTeamsUseCase,
    private readonly getTeam: GetSupportTeamUseCase,
    private readonly createTeam: CreateSupportTeamUseCase,
    private readonly updateTeam: UpdateSupportTeamUseCase,
    private readonly setMembers: SetSupportTeamMembersUseCase,
    private readonly setScope: SetSupportTeamScopeUseCase,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Support teams of the caller organization.' })
  async list(@Req() req: AuthenticatedRequest): Promise<SupportTeamResponse[]> {
    const teams = await this.listTeams.execute(actorOf(req));
    return teams.map(toResponse);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a support team. It starts organization-wide.',
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSupportTeamDto,
  ): Promise<SupportTeamResponse> {
    return toResponse(
      await this.createTeam.execute(actorOf(req), {
        code: dto.code,
        name: dto.name,
      }),
    );
  }

  // Declared BEFORE ':teamId': Nest matches in declaration order, so a
  // literal 'mine' after the parameter route would be read as a team id.
  // The UUID pipe would refuse it with a 400, which is a confusing answer to
  // a correct request rather than a harmless one.
  @Get('mine')
  @ApiOperation({
    summary:
      "The caller's own active teams. No permission key — see the use case.",
  })
  async mine(@Req() req: AuthenticatedRequest): Promise<SupportTeamResponse[]> {
    const teams = await this.myTeams.execute(actorOf(req));
    return teams.map(toResponse);
  }

  @Get(':teamId')
  @ApiOperation({ summary: 'One team with its people and its branch reach.' })
  async detail(
    @Req() req: AuthenticatedRequest,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
  ): Promise<SupportTeamDetailResponse> {
    const detail = await this.getTeam.execute(actorOf(req), teamId);
    return {
      ...toResponse(detail.team),
      memberUserIds: detail.memberUserIds,
      branchIds: detail.branchIds,
    };
  }

  @Patch(':teamId')
  @ApiOperation({ summary: 'Rename or archive a team.' })
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Body() dto: UpdateSupportTeamDto,
  ): Promise<SupportTeamResponse> {
    return toResponse(
      await this.updateTeam.execute(actorOf(req), {
        teamId,
        name: dto.name,
        status: dto.status,
      }),
    );
  }

  @Patch(':teamId/members')
  @ApiOperation({ summary: "Replace the team's people, by userId." })
  async members(
    @Req() req: AuthenticatedRequest,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Body() dto: SetSupportTeamMembersDto,
  ): Promise<{ teamId: string; memberUserIds: string[] }> {
    return {
      teamId,
      memberUserIds: await this.setMembers.execute(actorOf(req), {
        teamId,
        userIds: dto.userIds,
      }),
    };
  }

  @Patch(':teamId/branches')
  @ApiOperation({
    summary: "Replace the team's branch reach. Empty is organization-wide.",
  })
  async scope(
    @Req() req: AuthenticatedRequest,
    @Param('teamId', new ParseUUIDPipe()) teamId: string,
    @Body() dto: SetSupportTeamScopeDto,
  ): Promise<{ teamId: string; branchIds: string[] }> {
    return {
      teamId,
      branchIds: await this.setScope.execute(actorOf(req), {
        teamId,
        branchIds: dto.branchIds,
      }),
    };
  }
}

function toResponse(team: SupportTeam): SupportTeamResponse {
  return {
    teamId: team.id,
    code: team.code,
    name: team.name,
    status: team.status,
  };
}
