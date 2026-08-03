import {
  Controller,
  Get,
  Optional,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  ReconcileStructureUseCase,
  type ReconcileStructureResult,
} from '../../application/use-cases/reconcile-structure';
import { InternalServiceGuard } from './internal-service.guard';

/**
 * Projection health and repair, for an operator (Sprint 9.16).
 *
 * **This is a write path behind the service credential, and Sprints 9.10 and
 * 9.11 deleted exactly that shape for memberships and structure. It is a
 * different act, and the difference is the justification.**
 *
 * Those endpoints changed DOMAIN state on behalf of a person with no person
 * attached — a role somebody was granted, a branch somebody renamed — so the
 * audit question "who decided this" had a subject and no answer. This one
 * decides nothing. It converges a cache toward the service that owns the data,
 * it can only write rows the event stream would have written anyway, and there
 * is no version of it that expresses a human choice. The question those
 * deletions were about does not arise.
 *
 * It stays off the api-gateway's routing table like every `/internal/*`
 * controller, and the gateway strips `x-internal-service-token` from every
 * inbound request, so a browser has no path here.
 *
 * GET is the integrity check and writes nothing. POST repairs.
 */
@ApiExcludeController()
@Controller('internal/projections/structure')
@UseGuards(InternalServiceGuard)
export class InternalProjectionsController {
  constructor(
    @Optional()
    private readonly reconcile: ReconcileStructureUseCase | null = null,
  ) {}

  /**
   * Drift report. Reads the whole snapshot, writes nothing, and answers the
   * same counters a repair would produce — so `inserted` and `updated` both
   * zero is what a healthy projection looks like.
   */
  @Get()
  async check(): Promise<ReconcileStructureResult> {
    return this.require().execute({ dryRun: true });
  }

  @Post('reconcile')
  async run(
    @Query('branchesAfter') branchesAfter?: string,
    @Query('stationsAfter') stationsAfter?: string,
    @Query('teamsAfter') teamsAfter?: string,
  ): Promise<ReconcileStructureResult> {
    // Cursors are a convenience for resuming a long run. Re-running from the
    // beginning is always safe — every write is idempotent under the
    // projection's last-write-wins guard — so an operator who is unsure should
    // pass nothing.
    return this.require().execute({
      after: {
        branches: branchesAfter,
        stations: stationsAfter,
        teams: teamsAfter,
      },
    });
  }

  private require(): ReconcileStructureUseCase {
    if (!this.reconcile) {
      // 503 rather than 404: the route exists and the dependency does not, so
      // the honest answer is "not right now" and it invites a retry after the
      // configuration is fixed.
      throw new ServiceUnavailableException(
        'structure reconciliation is not configured: ORGANIZATIONS_SERVICE_URL and INTERNAL_SERVICE_TOKEN must both be set',
      );
    }
    return this.reconcile;
  }
}
