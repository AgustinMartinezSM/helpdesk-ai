import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import {
  ImportPeopleUseCase,
  type ImportPeopleResult,
} from '../../application/use-cases/import-people';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';
import { ImportPeopleDto } from './dto';

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

/**
 * Bringing people in from a spreadsheet (Sprint 9.15).
 *
 * Two routes over one payload, and the file is sent to both. The preview
 * writes nothing and the apply re-parses and re-validates from scratch — it
 * never trusts what the preview concluded, so a file edited between the two
 * calls cannot get a row past a preview that approved a different one.
 *
 * The CSV travels as TEXT IN A JSON FIELD rather than as multipart: the
 * gateway client speaks JSON, and a payload this size does not justify a new
 * transport through three processes.
 *
 * The tenant comes from the token, like every other public route since Sprint
 * 9.11.
 */
@ApiTags('people-import')
@ApiBearerAuth()
@Controller('organizations/people-import')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class PeopleImportController {
  constructor(private readonly importPeople: ImportPeopleUseCase) {}

  @Get('template')
  @ApiOperation({
    summary:
      'A CSV template pre-filled with the roles THIS caller may grant (people.import)',
  })
  async template(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ filename: string; csv: string }> {
    // Returned as JSON rather than as a file download, so the one BFF response
    // shape holds and the browser decides what to name the file it saves.
    return {
      filename: 'helpdesk-people-import.csv',
      csv: await this.importPeople.template(actorOf(req)),
    };
  }

  // 200, not Nest's default 201 for a POST. A preview creates nothing, and a
  // Created status on a dry run is a lie told in the protocol rather than in
  // the copy. The apply is 200 too: it answers with a summary of a batch, not
  // with one created resource at a location — and a run where every row was
  // skipped creates nothing at all.
  @Post('preview')
  @HttpCode(200)
  @ApiOperation({
    summary: 'What the file WOULD do. Writes nothing (people.import).',
  })
  async preview(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportPeopleDto,
  ): Promise<ImportPeopleResult> {
    return this.importPeople.execute(actorOf(req), {
      csv: dto.csv,
      dryRun: true,
    });
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Apply the file. Per row, no batch rollback, safe to re-run (people.import).',
  })
  async apply(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ImportPeopleDto,
  ): Promise<ImportPeopleResult> {
    // Each issued code appears here exactly once, the same rule the single
    // invitation follows: it is never stored, logged or published, and no
    // endpoint can produce it a second time.
    return this.importPeople.execute(actorOf(req), {
      csv: dto.csv,
      dryRun: false,
    });
  }
}
