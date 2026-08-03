import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ChangeMembershipRoleUseCase } from '../../application/use-cases/change-membership-role';
import { ChangeMembershipStatusUseCase } from '../../application/use-cases/change-membership-status';
import {
  GetMembershipBranchesUseCase,
  ListBranchesUseCase,
  SetMembershipBranchesUseCase,
} from '../../application/use-cases/membership-branches';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';
import {
  ChangeMembershipRoleDto,
  ChangeMembershipStatusDto,
  SetMembershipBranchesDto,
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

interface MembershipStatusResponse {
  userId: string;
  status: string;
  version: number;
}

interface MembershipRoleResponse {
  userId: string;
  roleTemplate: string;
  version: number;
}

interface MembershipBranchesResponse {
  userId: string;
  branchIds: string[];
}

interface BranchResponse {
  id: string;
  code: string;
  name: string;
  status: string;
}

/**
 * Member administration (Sprint 9.10, ADR 0021).
 *
 * These four routes replace the interim operator endpoints that used to do
 * the same work behind `INTERNAL_SERVICE_TOKEN`. That surface was written
 * "until the people-management sprint builds the real one, with a person's
 * token and an audit trail behind it" and was deleted in the same commit that
 * added this one — leaving it as a break-glass path would have left an
 * unattributable write path live, which is what ADR 0016 forbids.
 *
 * The response bodies name `userId` rather than the membership id: the
 * membership id is this service's internal key, and nothing outside needs to
 * learn it to administer a person.
 */
@ApiTags('memberships')
@ApiBearerAuth()
@Controller('organizations/memberships')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class MembershipsController {
  constructor(
    private readonly changeMembershipRole: ChangeMembershipRoleUseCase,
    private readonly changeMembershipStatus: ChangeMembershipStatusUseCase,
    private readonly getMembershipBranches: GetMembershipBranchesUseCase,
    private readonly setMembershipBranches: SetMembershipBranchesUseCase,
  ) {}

  @Patch(':userId/role')
  @ApiOperation({ summary: "Change a member's role template." })
  async changeRole(
    @Req() req: AuthenticatedRequest,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ChangeMembershipRoleDto,
  ): Promise<MembershipRoleResponse> {
    const updated = await this.changeMembershipRole.execute(actorOf(req), {
      userId,
      roleTemplate: dto.roleTemplate,
    });
    return {
      userId: updated.userId,
      roleTemplate: updated.roleTemplate,
      version: updated.version,
    };
  }

  @Patch(':userId/status')
  @ApiOperation({
    summary: 'Suspend, reinstate or remove a member. Removal is deactivation.',
  })
  async changeStatus(
    @Req() req: AuthenticatedRequest,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ChangeMembershipStatusDto,
  ): Promise<MembershipStatusResponse> {
    const updated = await this.changeMembershipStatus.execute(actorOf(req), {
      userId,
      to: dto.status,
    });
    return {
      userId: updated.userId,
      status: updated.status,
      version: updated.version,
    };
  }

  @Get(':userId/branches')
  async branches(
    @Req() req: AuthenticatedRequest,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<MembershipBranchesResponse> {
    return {
      userId,
      branchIds: await this.getMembershipBranches.execute(actorOf(req), userId),
    };
  }

  /**
   * PATCH with the full desired set rather than a PUT or DELETE per branch:
   * one request expresses the editor's intent, repeating it converges, and
   * web-bff's GatewayClient speaks GET/POST/PATCH only.
   */
  @Patch(':userId/branches')
  @ApiOperation({ summary: 'Replace the branches a member covers.' })
  async setBranches(
    @Req() req: AuthenticatedRequest,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: SetMembershipBranchesDto,
  ): Promise<MembershipBranchesResponse> {
    return {
      userId,
      branchIds: await this.setMembershipBranches.execute(actorOf(req), {
        userId,
        branchIds: dto.branchIds,
      }),
    };
  }
}

/**
 * The branch listing the editor above draws from. It lives beside that editor
 * because it is the only thing that reads it: creating, renaming and
 * archiving branches is still operator work on the internal surface, and this
 * sprint's claim is only that no ONBOARDING step is unattributable.
 */
@ApiTags('memberships')
@ApiBearerAuth()
@Controller('organizations/branches')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class OrganizationBranchesController {
  constructor(private readonly listBranches: ListBranchesUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Branches of the caller organization, archived ones included.',
  })
  async list(@Req() req: AuthenticatedRequest): Promise<BranchResponse[]> {
    const branches = await this.listBranches.execute(actorOf(req));
    return branches.map((branch) => ({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      status: branch.status,
    }));
  }
}
