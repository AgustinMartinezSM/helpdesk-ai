import {
  Body,
  Controller,
  Post,
  Req,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { AccessTokenPayload, Actor } from '@helpdesk-ai/security';
import { JwtAccessGuard } from '@helpdesk-ai/security';
import { ORGANIZATION_NAME_MAX_LENGTH } from '../../domain/organization';
import { CreateOrganizationUseCase } from '../../application/use-cases/create-organization';
import { OrganizationDomainErrorFilter } from '../organization-domain-error.filter';

export class CreateOrganizationDto {
  /**
   * The display name, and the ONLY thing the caller supplies. The slug is
   * derived — see the use case for why it cannot be chosen: a caller-picked
   * slug that could be refused for being taken would answer "does an
   * organization by this name exist?" across tenants.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(ORGANIZATION_NAME_MAX_LENGTH)
  name!: string;
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
 * Creating an organization.
 *
 * Tenantless and keyless on purpose, the shape `POST invitations/accept`
 * already uses: the caller does not belong to a real organization yet — that
 * is the precondition, not an oversight — so there is no tenant to require
 * and no permission a non-member could hold. Being the authenticated caller
 * IS the authorization, the same argument `PATCH /users/me` rests on.
 *
 * The creator is read from the verified token and never from the body. A
 * body field would let whoever holds any account create an organization
 * owned by somebody else.
 */
@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
@UseGuards(JwtAccessGuard)
@UseFilters(OrganizationDomainErrorFilter)
export class OrganizationsController {
  constructor(private readonly createOrganization: CreateOrganizationUseCase) {}

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
}
