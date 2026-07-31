import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ChangeMembershipStatusUseCase } from '../../application/use-cases/change-membership-status';
import {
  GetMembershipUseCase,
  type MembershipView,
} from '../../application/use-cases/get-membership';
import { ChangeMembershipStatusDto } from './dto';
import { InternalServiceGuard } from './internal-service.guard';
import { OrganizationDomainErrorFilter } from './organization-domain-error.filter';

interface ChangedStatusResponse {
  status: string;
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
 */
@ApiExcludeController()
@Controller('internal/organizations/:organizationId/memberships')
@UseGuards(InternalServiceGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class InternalOrganizationMembershipsController {
  constructor(
    private readonly getMembership: GetMembershipUseCase,
    private readonly changeMembershipStatus: ChangeMembershipStatusUseCase,
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
}
