import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import {
  STRUCTURE_SNAPSHOT_REPOSITORY,
  type StructureSnapshotRepository,
} from '../../application/ports/structure-snapshot.repository';
import { InternalServiceGuard } from './internal-service.guard';

/**
 * Page size. Bounded on both sides: a caller asking for one row at a time
 * would make a rebuild take a request per branch, and one asking for
 * everything would build a response nobody sized.
 */
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SnapshotResponse<T> {
  items: T[];
  /** Pass back as `after` to continue; null means this was the last page. */
  nextCursor: string | null;
}

/**
 * The projection snapshot organizations-service offers its consumers
 * (Sprint 9.16).
 *
 * **Why this exists.** A consumer's durable queue does not exist before its
 * first boot, and a topic exchange discards a message with no bound queue — so
 * a service deployed after this one starts with an empty projection and fills
 * only from the next event. tickets-service validates ticket creation against
 * exactly those rows, so a cold one refuses every located ticket. Editing a
 * branch to make it re-emit is not a recovery mechanism; this is.
 *
 * **Why HTTP rather than a shared database.** ADR 0003 forbids cross-service
 * foreign keys and, with it, reaching into a peer's schema. The owner answers
 * questions about its own data; nobody else reads its tables.
 *
 * **Read-only, and it must stay that way.** Nothing here writes. It sits
 * behind `InternalServiceGuard` like the two membership lookups Sprint 9.11
 * left as the only things that credential opens, it is absent from the
 * api-gateway's routing table, and the gateway strips the header from every
 * inbound request — so a browser has no path to any of it.
 *
 * **Why the rows are global rather than per organization.** The caller cannot
 * be scoped: it is rebuilding a cache and has to learn about organizations it
 * has never seen. Tenant safety comes from the rows instead — each states its
 * own organization, and the consumer writes that value, so a global read
 * cannot produce a row under the wrong tenant.
 */
@ApiExcludeController()
@Controller('internal/structure')
@UseGuards(InternalServiceGuard)
export class InternalStructureSnapshotController {
  constructor(
    @Inject(STRUCTURE_SNAPSHOT_REPOSITORY)
    private readonly snapshot: StructureSnapshotRepository,
  ) {}

  @Get('branches')
  async branches(
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ): Promise<SnapshotResponse<unknown>> {
    return this.snapshot.branches(cursorOf(after), limitOf(limit));
  }

  @Get('stations')
  async stations(
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ): Promise<SnapshotResponse<unknown>> {
    return this.snapshot.stations(cursorOf(after), limitOf(limit));
  }

  @Get('teams')
  async teams(
    @Query('after') after?: string,
    @Query('limit') limit?: string,
  ): Promise<SnapshotResponse<unknown>> {
    return this.snapshot.teams(cursorOf(after), limitOf(limit));
  }
}

/**
 * A malformed cursor is refused rather than treated as "start from the
 * beginning": silently restarting a resumed run would repeat work the caller
 * believed it had finished, and it would do so without saying anything.
 */
function cursorOf(after: string | undefined): string | null {
  if (after === undefined || after === '') {
    return null;
  }
  if (!UUID.test(after)) {
    throw new BadRequestException('after must be a uuid');
  }
  return after;
}

function limitOf(limit: string | undefined): number {
  if (limit === undefined || limit === '') {
    return DEFAULT_LIMIT;
  }
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_LIMIT) {
    throw new BadRequestException(`limit must be an integer 1..${MAX_LIMIT}`);
  }
  return parsed;
}
