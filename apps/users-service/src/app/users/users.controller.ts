import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
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
import type { FieldDefinition } from '../../domain/profile-fields';
import type { UserProfile } from '../../domain/user-profile';
import {
  GetMyProfileUseCase,
  GetUserProfileUseCase,
  ListUserProfilesUseCase,
  type ProfileView,
} from '../../application/use-cases/profile-queries';
import {
  CreateFieldDefinitionUseCase,
  ListFieldDefinitionsUseCase,
  UpdateFieldDefinitionUseCase,
} from '../../application/use-cases/manage-field-definitions';
import {
  SetMemberFieldValueUseCase,
  SetMyFieldValueUseCase,
} from '../../application/use-cases/set-field-value';
import {
  UpdateMemberPersonProfileUseCase,
  UpdateMyPersonProfileUseCase,
} from '../../application/use-cases/update-person-profile';
import {
  CreateFieldDefinitionDto,
  SetFieldValueDto,
  UpdateFieldDefinitionDto,
  UpdatePersonProfileDto,
} from './dto';
import { UserDomainErrorFilter } from './user-domain-error.filter';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return {
    id: req.user.sub,
    // Both undefined/empty on a token minted without a tenant. Read from the
    // payload the guard already verified — no second decoding.
    organizationId: req.user.org,
    permissions: new Set(req.user.perms ?? []),
  };
}

/** Wire shapes: dates travel as ISO strings. */
interface ProfileFieldEntryResponse {
  key: string;
  labelEsAr: string;
  labelEnUs: string;
  type: string;
  value: string | null;
}

interface UserProfileResponse {
  userId: string;
  email: string;
  displayName: string;
  preferredName: string | null;
  phone: string | null;
  language: string | null;
  timezone: string | null;
  registeredAt: string;
  /**
   * The org-defined fields the VIEWER may see, already filtered server-side
   * through the one view filter (D4). Absent on the person-edit responses,
   * which return only what they touched.
   */
  fields?: ProfileFieldEntryResponse[];
}

interface FieldDefinitionResponse {
  id: string;
  key: string;
  labelEsAr: string;
  labelEnUs: string;
  type: string;
  required: boolean;
  editableByUser: boolean;
  visibleToRequester: boolean;
  visibleToStaff: boolean;
  displayOrder: number;
  validation: Record<string, unknown> | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

function toProfileResponse(profile: UserProfile): UserProfileResponse {
  return {
    userId: profile.userId,
    email: profile.email,
    displayName: profile.displayName,
    preferredName: profile.preferredName,
    phone: profile.phone,
    language: profile.language,
    timezone: profile.timezone,
    registeredAt: profile.registeredAt.toISOString(),
  };
}

function toViewResponse(view: ProfileView): UserProfileResponse {
  return {
    ...toProfileResponse(view.profile),
    fields: view.fields.map((field) => ({
      key: field.definition.key,
      labelEsAr: field.definition.labelEsAr,
      labelEnUs: field.definition.labelEnUs,
      type: field.definition.type,
      value: field.value,
    })),
  };
}

function toDefinitionResponse(
  definition: FieldDefinition,
): FieldDefinitionResponse {
  return {
    id: definition.id,
    key: definition.key,
    labelEsAr: definition.labelEsAr,
    labelEnUs: definition.labelEnUs,
    type: definition.type,
    required: definition.required,
    editableByUser: definition.editableByUser,
    visibleToRequester: definition.visibleToRequester,
    visibleToStaff: definition.visibleToStaff,
    displayOrder: definition.displayOrder,
    validation: (definition.validation as Record<string, unknown>) ?? null,
    status: definition.status,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  };
}

/**
 * Route note: literal segments (me, organization/fields) are declared before
 * the :userId parameter routes, so Nest matches them first. The field-config
 * surface nests under /users/* because users-service owns that prefix
 * through the gateway; the org-admin surface proper arrives in 9.8.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAccessGuard)
@UseFilters(UserDomainErrorFilter)
export class UsersController {
  constructor(
    private readonly getMyProfile: GetMyProfileUseCase,
    private readonly listProfiles: ListUserProfilesUseCase,
    private readonly getUserProfile: GetUserProfileUseCase,
    private readonly updateMyProfile: UpdateMyPersonProfileUseCase,
    private readonly updateMemberProfile: UpdateMemberPersonProfileUseCase,
    private readonly setMyFieldValue: SetMyFieldValueUseCase,
    private readonly setMemberFieldValue: SetMemberFieldValueUseCase,
    private readonly createFieldDefinition: CreateFieldDefinitionUseCase,
    private readonly updateFieldDefinition: UpdateFieldDefinitionUseCase,
    private readonly listFieldDefinitions: ListFieldDefinitionsUseCase,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Own profile; 404 until the registration event has been projected',
  })
  async me(@Req() req: AuthenticatedRequest): Promise<UserProfileResponse> {
    return toViewResponse(await this.getMyProfile.execute(actorOf(req)));
  }

  @Patch('me')
  @ApiOperation({
    summary:
      'Edit own person-level fields; no permission key — being yourself is the authorization',
  })
  async updateMe(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdatePersonProfileDto,
  ): Promise<UserProfileResponse> {
    // Person and org edits stay on separate endpoints on purpose: this one
    // needs no permission and no tenant, the field endpoints need both
    // context and definition checks — one body accepting both would blur
    // exactly the authorization line that keeps each simple.
    return toProfileResponse(
      await this.updateMyProfile.execute(actorOf(req), dto),
    );
  }

  @Put('me/fields/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Set or clear (value: null) own value for a user-editable field of the own organization',
  })
  async putMyField(
    @Req() req: AuthenticatedRequest,
    @Param('key') key: string,
    @Body() dto: SetFieldValueDto,
  ): Promise<void> {
    await this.setMyFieldValue.execute(actorOf(req), key, dto.value);
  }

  @Get('organization/fields')
  @ApiOperation({
    summary:
      "The organization's field definitions (organization.update); ?includeArchived=true adds archived ones",
  })
  async listFields(
    @Req() req: AuthenticatedRequest,
    @Query('includeArchived') includeArchived?: string,
  ): Promise<FieldDefinitionResponse[]> {
    const definitions = await this.listFieldDefinitions.execute(
      actorOf(req),
      includeArchived === 'true',
    );
    return definitions.map(toDefinitionResponse);
  }

  @Post('organization/fields')
  @ApiOperation({
    summary: 'Define a profile field (organization.update); the key is forever',
  })
  async createField(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateFieldDefinitionDto,
  ): Promise<FieldDefinitionResponse> {
    return toDefinitionResponse(
      await this.createFieldDefinition.execute(actorOf(req), dto),
    );
  }

  @Patch('organization/fields/:id')
  @ApiOperation({
    summary:
      'Edit labels/flags/order/validation/status — never key or type (409); archiving is a status edit',
  })
  async patchField(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFieldDefinitionDto,
  ): Promise<FieldDefinitionResponse> {
    return toDefinitionResponse(
      await this.updateFieldDefinition.execute(actorOf(req), id, dto),
    );
  }

  @Get()
  @ApiOperation({
    summary: "Directory of the caller's organization (people.read)",
  })
  async list(@Req() req: AuthenticatedRequest): Promise<UserProfileResponse[]> {
    const views = await this.listProfiles.execute(actorOf(req));
    return views.map(toViewResponse);
  }

  @Get(':userId')
  @ApiOperation({
    summary:
      "One member of the caller's organization (people.read); non-members answer 404",
  })
  async getUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<UserProfileResponse> {
    return toViewResponse(
      await this.getUserProfile.execute(actorOf(req), userId),
    );
  }

  @Patch(':userId/profile')
  @ApiOperation({
    summary:
      "Edit a member's person-level fields (people.update); same whitelist as /users/me",
  })
  async patchUserProfile(
    @Req() req: AuthenticatedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: UpdatePersonProfileDto,
  ): Promise<UserProfileResponse> {
    return toProfileResponse(
      await this.updateMemberProfile.execute(actorOf(req), userId, dto),
    );
  }

  @Put(':userId/fields/:key')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      "Set or clear a member's value for any active field (people.update); foreign targets answer 404",
  })
  async putUserField(
    @Req() req: AuthenticatedRequest,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('key') key: string,
    @Body() dto: SetFieldValueDto,
  ): Promise<void> {
    await this.setMemberFieldValue.execute(
      actorOf(req),
      userId,
      key,
      dto.value,
    );
  }
}
