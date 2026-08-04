import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
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

  /**
   * `?organizationId=` asks for a specific one (Sprint 10.6, ADR 0025).
   *
   * Absent, the default rule runs and nothing about this endpoint's behaviour
   * changes. Present, it is a REQUEST that is validated against the stored
   * membership — an id the caller cannot honour answers with the same nulls a
   * person who belongs nowhere gets, and auth-service decides what that means
   * (the exchange refuses; a refresh falls back). The response shape does not
   * grow a "why" field on purpose: auth-service already knows what it asked
   * for and can compare, and a reason here would be a second vocabulary for
   * a decision the caller is making anyway.
   */
  @Get(':userId/active')
  async active(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Query('organizationId', new ParseUUIDPipe({ optional: true }))
    organizationId?: string,
  ): Promise<ActiveMembershipResponse> {
    const resolved = await this.resolveActiveMembership.execute(
      userId,
      organizationId,
    );

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
