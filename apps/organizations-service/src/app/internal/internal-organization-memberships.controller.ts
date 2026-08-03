import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  GetMembershipUseCase,
  type MembershipView,
} from '../../application/use-cases/get-membership';
import { InternalServiceGuard } from './internal-service.guard';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';

/**
 * Membership verification, service to service.
 *
 * This is the check tickets-service runs before assigning a ticket: it
 * returns status AND template permissions so the caller decides what a
 * non-active membership means for its operation — this endpoint reports
 * standing, it does not rule on access.
 *
 * It used to have company. A status PATCH, a role PATCH and a branch
 * PUT/DELETE lived here as the operator surface "until the people-management
 * sprint builds the real one, with a person's token and an audit trail behind
 * it". Sprint 9.10 built it (`organizations/memberships`) and deleted them in
 * the same commit rather than deprecating them: an unattributable write path
 * kept around for emergencies is the one that gets used, and ADR 0016's rule
 * is not conditional. What is left here is a read.
 */
@ApiExcludeController()
@Controller('internal/organizations/:organizationId/memberships')
@UseGuards(InternalServiceGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class InternalOrganizationMembershipsController {
  constructor(private readonly getMembership: GetMembershipUseCase) {}

  @Get(':userId')
  async membership(
    @Param('organizationId', new ParseUUIDPipe()) organizationId: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<MembershipView> {
    return this.getMembership.execute(organizationId, userId);
  }
}
