import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AssignBranchMembershipUseCase } from '../../application/use-cases/assign-branch-membership';
import { ChangeMembershipRoleUseCase } from '../../application/use-cases/change-membership-role';
import { ChangeMembershipStatusUseCase } from '../../application/use-cases/change-membership-status';
import {
  GetMembershipUseCase,
  type MembershipView,
} from '../../application/use-cases/get-membership';
import { RemoveBranchMembershipUseCase } from '../../application/use-cases/remove-branch-membership';
import { ChangeMembershipRoleDto, ChangeMembershipStatusDto } from './dto';
import { InternalServiceGuard } from './internal-service.guard';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';

interface ChangedStatusResponse {
  status: string;
  version: number;
}

interface ChangedRoleResponse {
  roleTemplate: string;
  version: number;
}

/**
 * Membership verification and lifecycle, service to service.
 *
 * GET is the check tickets-service runs before assigning a ticket: it
 * returns status AND template permissions so the caller decides what a
 * non-active membership means for its operation — this endpoint reports
 * standing, it does not rule on access.
 *
 * PATCH is the operator surface for suspend/reactivate/deactivate until the
 * people-management sprint builds the real one, with a person's token and an
 * audit trail behind it. It exists now because the membership events and the
 * `mv` bump have to be exercisable before that sprint lands.
 *
 * The role PATCH and the branch PUT/DELETE join it for the same interim
 * reason (Sprint 9.5): the retail scenario needs a branch manager covering
 * branches before the people-management surface exists.
 */
@ApiExcludeController()
@Controller('internal/organizations/:organizationId/memberships')
@UseGuards(InternalServiceGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class InternalOrganizationMembershipsController {
  constructor(
    private readonly getMembership: GetMembershipUseCase,
    private readonly changeMembershipStatus: ChangeMembershipStatusUseCase,
    private readonly changeMembershipRole: ChangeMembershipRoleUseCase,
    private readonly assignBranchMembership: AssignBranchMembershipUseCase,
    private readonly removeBranchMembership: RemoveBranchMembershipUseCase,
  ) {}

  @Get(':userId')
  async membership(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<MembershipView> {
    return this.getMembership.execute(organizationId, userId);
  }

  @Patch(':userId/status')
  async changeStatus(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ChangeMembershipStatusDto,
  ): Promise<ChangedStatusResponse> {
    const updated = await this.changeMembershipStatus.execute({
      organizationId,
      userId,
      to: dto.status,
    });
    return { status: updated.status, version: updated.version };
  }

  @Patch(':userId/role')
  async changeRole(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() dto: ChangeMembershipRoleDto,
  ): Promise<ChangedRoleResponse> {
    const updated = await this.changeMembershipRole.execute({
      organizationId,
      userId,
      roleTemplate: dto.roleTemplate,
    });
    return { roleTemplate: updated.roleTemplate, version: updated.version };
  }

  /**
   * PUT/DELETE because the edge is a state, not a mutation: repeating
   * either request converges on the same row set, which is what makes the
   * operator surface safe to retry blindly.
   */
  @Put(':userId/branches/:branchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async putBranch(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ): Promise<void> {
    await this.assignBranchMembership.execute({
      organizationId,
      userId,
      branchId,
    });
  }

  @Delete(':userId/branches/:branchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBranch(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Param('branchId', new ParseUUIDPipe()) branchId: string,
  ): Promise<void> {
    await this.removeBranchMembership.execute({
      organizationId,
      userId,
      branchId,
    });
  }
}
