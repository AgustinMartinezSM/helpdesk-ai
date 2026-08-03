import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { AccessTokenPayload, Actor } from '@helpdesk-ai/security';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import {
  normalizeOrganizationName,
  ORGANIZATION_NAME_MAX_LENGTH,
  ORGANIZATION_NAME_MIN_LENGTH,
} from '../../domain/organization';
import { CreateOrganizationUseCase } from '../../application/use-cases/create-organization';
import {
  GetOrganizationUseCase,
  RenameOrganizationUseCase,
} from '../../application/use-cases/organization-identity';
import { TransferOrganizationOwnershipUseCase } from '../../application/use-cases/transfer-organization-ownership';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';

/**
 * The display name, and the ONLY thing a caller ever supplies about an
 * organization's identity. The slug is derived at creation and never accepted
 * here — a caller-picked slug that could be refused for being taken would
 * answer "does an organization by this name exist?" across tenants.
 *
 * Shared by creation and renaming so the two cannot drift on what a valid name
 * is. The transform runs the domain's normaliser rather than a bare `trim()`,
 * so the length rules below are applied to the string that will actually be
 * stored: without it, eighty characters of name plus a run of spaces would pass
 * a check the stored value no longer matches.
 */
export class OrganizationNameDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? normalizeOrganizationName(value) : value,
  )
  @IsString()
  @MinLength(ORGANIZATION_NAME_MIN_LENGTH)
  @MaxLength(ORGANIZATION_NAME_MAX_LENGTH)
  name!: string;
}

export class CreateOrganizationDto extends OrganizationNameDto {}

export class RenameOrganizationDto extends OrganizationNameDto {}

export class TransferOwnershipDto {
  /**
   * Who receives it, named by user id rather than membership id: the
   * membership id is this service's internal key and nothing a browser can
   * reach ever returns one (Sprint 9.10's rule for the whole people surface).
   */
  @IsUUID()
  userId!: string;
}

interface CreatedOrganizationResponse {
  organizationId: string;
  slug: string;
  name: string;
  /**
   * Said out loud in the response because the browser has to act on it: the
   * new membership does not change the token that made this request, so the
   * screen must refresh the session before the person is actually inside the
   * organization they just created. `/join` learned the same lesson in 9.9.
   */
  sessionRefreshRequired: true;
}

interface OrganizationResponse {
  organizationId: string;
  /** Stable. Nothing on this controller can change it — see ADR 0024. */
  slug: string;
  name: string;
}

interface CurrentOrganizationResponse extends OrganizationResponse {
  /**
   * Read from the stored row at request time, not from the token.
   *
   * It is what the settings screen renders the ownership section from
   * (ADR 0020), and it is deliberately fresher than the permission snapshot
   * beside it: somebody who handed the organization over five minutes ago
   * still carries a token that says owner, and the control they must not see
   * is the one that would take it back.
   */
  viewerIsOwner: boolean;
}

interface OwnershipTransferResponse {
  organizationId: string;
  previousOwnerUserId: string;
  newOwnerUserId: string;
  /**
   * The caller's OWN membership changed underneath them — they are an
   * `organization_admin` now. Their token still says otherwise for up to
   * JWT_ACCESS_TTL_SECONDS, so the screen refreshes rather than waiting it out.
   */
  sessionRefreshRequired: true;
}

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
 * The organization itself: creating one, reading the one you are in, changing
 * its display name, and handing it on.
 *
 * `POST /organizations` is tenantless and keyless on purpose, the shape
 * `POST invitations/accept` already uses: the caller does not belong to a real
 * organization yet — that is the precondition, not an oversight — so there is
 * no tenant to require and no permission a non-member could hold. Being the
 * authenticated caller IS the authorization, the same argument `PATCH
 * /users/me` rests on.
 *
 * **The other three are the opposite** and it is worth saying why they share a
 * controller: each takes its tenant from the token through
 * `requireOrganization`, and no route here has ever taken an organization id
 * from a path or a body. An operator holding the database could be trusted to
 * name a tenant; a browser cannot (Sprint 9.11). The creator of a new
 * organization is read from the verified token for the same reason — a body
 * field would let whoever holds any account create an organization owned by
 * somebody else.
 *
 * Route order needs no care here: `current` and `ownership/transfer` are
 * literal segments and this controller declares no parameterised path.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class OrganizationsController {
  constructor(
    private readonly createOrganization: CreateOrganizationUseCase,
    private readonly getOrganization: GetOrganizationUseCase,
    private readonly renameOrganization: RenameOrganizationUseCase,
    private readonly transferOwnership: TransferOrganizationOwnershipUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Create an organization and become its owner. Refused if you already belong to one.',
  })
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateOrganizationDto,
  ): Promise<CreatedOrganizationResponse> {
    const created = await this.createOrganization.execute(actorOf(req), {
      name: dto.name,
    });

    return {
      organizationId: created.organization.id,
      slug: created.organization.slug,
      name: created.organization.name,
      sessionRefreshRequired: true,
    };
  }

  @Get('current')
  @ApiOperation({
    summary:
      'The organization your token places you in, and whether you own it (organization.read).',
  })
  async current(
    @Req() req: AuthenticatedRequest,
  ): Promise<CurrentOrganizationResponse> {
    const { organization, viewerIsOwner } = await this.getOrganization.execute(
      actorOf(req),
    );
    return {
      organizationId: organization.id,
      slug: organization.slug,
      name: organization.name,
      viewerIsOwner,
    };
  }

  @Patch('current')
  @ApiOperation({
    summary:
      'Change the display name (organization.update). The slug does not change.',
  })
  async rename(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RenameOrganizationDto,
  ): Promise<OrganizationResponse> {
    const renamed = await this.renameOrganization.execute(actorOf(req), {
      name: dto.name,
    });
    return {
      organizationId: renamed.id,
      // Echoed on every response so a caller can see for themselves that it
      // did not move, rather than taking the documentation's word for it.
      slug: renamed.slug,
      name: renamed.name,
    };
  }

  /**
   * POST rather than PATCH, following `invitations/:id/revoke`: this is a named
   * irreversible act on the organization, not a field somebody is editing, and
   * the URL should read like the thing being confirmed.
   *
   * 200 rather than 201 — nothing was created. Two rows changed template.
   */
  @Post('ownership/transfer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Hand the organization to an active member. Only the current owner may.',
  })
  async transfer(
    @Req() req: AuthenticatedRequest,
    @Body() dto: TransferOwnershipDto,
  ): Promise<OwnershipTransferResponse> {
    const transferred = await this.transferOwnership.execute(actorOf(req), {
      userId: dto.userId,
    });

    return {
      organizationId: transferred.newOwner.organizationId,
      previousOwnerUserId: transferred.previousOwner.userId,
      newOwnerUserId: transferred.newOwner.userId,
      sessionRefreshRequired: true,
    };
  }
}
