import { Controller, Get, Req, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard, type AccessTokenPayload } from '@helpdesk-ai/security';
import {
  GetMyProfileUseCase,
  ListUserProfilesUseCase,
} from '../../application/use-cases/profile-queries';
import type { Actor, UserProfile } from '../../domain/user-profile';
import { UserDomainErrorFilter } from './user-domain-error.filter';

interface AuthenticatedRequest {
  user: AccessTokenPayload;
}

function actorOf(req: AuthenticatedRequest): Actor {
  return { id: req.user.sub, roles: req.user.roles };
}

/** Wire shape: dates travel as ISO strings. */
interface UserProfileResponse {
  userId: string;
  email: string;
  displayName: string;
  roles: string[];
  registeredAt: string;
}

function toResponse(profile: UserProfile): UserProfileResponse {
  return {
    userId: profile.userId,
    email: profile.email,
    displayName: profile.displayName,
    roles: profile.roles,
    registeredAt: profile.registeredAt.toISOString(),
  };
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAccessGuard)
@UseFilters(UserDomainErrorFilter)
export class UsersController {
  constructor(
    private readonly getMyProfile: GetMyProfileUseCase,
    private readonly listProfiles: ListUserProfilesUseCase,
  ) {}

  @Get('me')
  @ApiOperation({
    summary: 'Own profile; 404 until the registration event has been projected',
  })
  async me(@Req() req: AuthenticatedRequest): Promise<UserProfileResponse> {
    return toResponse(await this.getMyProfile.execute(actorOf(req)));
  }

  @Get()
  @ApiOperation({ summary: 'Directory of all profiles (staff only)' })
  async list(@Req() req: AuthenticatedRequest): Promise<UserProfileResponse[]> {
    const profiles = await this.listProfiles.execute(actorOf(req));
    return profiles.map(toResponse);
  }
}
