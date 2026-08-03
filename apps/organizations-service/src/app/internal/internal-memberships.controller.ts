import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ResolveActiveMembershipUseCase } from '../../application/use-cases/resolve-active-membership';
import { InternalServiceGuard } from './internal-service.guard';

interface ActiveMembershipResponse {
  organizationId: string | null;
  permissions: string[];
  membershipVersion: number | null;
  /**
   * Branch ids for the `br` claim (Sprint 9.5, D2). The name and the
   * always-present-possibly-empty shape are FROZEN — auth-service parses
   * exactly `branchIds: string[]`, so even the no-membership answer carries
   * an empty array rather than a null.
   */
  branchIds: string[];
  /**
   * Support team ids for the `tm` claim (Sprint 9.12). Same frozen
   * always-present-possibly-empty shape as branchIds, for the same reason.
   */
  teamIds: string[];
}

/**
 * The mint-time resolution endpoint (ADR 0014). auth-service is its only
 * caller — though no longer the only internal caller of this service: the
 * verification surface tickets-service uses lives in the sibling
 * organization-scoped controller. All of it is deliberately absent from the
 * api-gateway's routing table so a browser has no path to it at all.
 *
 * A user with no membership answers 200 with nulls rather than 404. The
 * distinction matters: "this user belongs nowhere" is a real, expected answer
 * during the migration — every user who registered before this service
 * existed is in that state until the backfill runs — and auth-service needs
 * to tell it apart from "the resolution call failed".
 */
@ApiExcludeController()
@Controller('internal/memberships')
@UseGuards(InternalServiceGuard)
export class InternalMembershipsController {
  constructor(
    private readonly resolveActiveMembership: ResolveActiveMembershipUseCase,
  ) {}

  @Get(':userId/active')
  async active(
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<ActiveMembershipResponse> {
    const resolved = await this.resolveActiveMembership.execute(userId);

    if (!resolved) {
      return {
        organizationId: null,
        permissions: [],
        membershipVersion: null,
        branchIds: [],
        teamIds: [],
      };
    }

    return {
      organizationId: resolved.organizationId,
      permissions: resolved.permissions,
      membershipVersion: resolved.membershipVersion,
      branchIds: resolved.branchIds,
      teamIds: resolved.teamIds,
    };
  }
}
