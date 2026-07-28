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
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Logger } from '@helpdesk-ai/observability';
import {
  InvalidCredentialsError,
  RefreshTokenReuseError,
} from '../../domain/errors';
import type { Session } from '../../application/session.service';
import { LoginUseCase } from '../../application/use-cases/login';
import { LogoutUseCase } from '../../application/use-cases/logout';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session';
import {
  RegisterUserUseCase,
  type RegisterUserOutput,
} from '../../application/use-cases/register-user';
import {
  JwtAccessGuard,
  type AccessTokenPayload,
} from '../guards/jwt-access.guard';
import { AuthDomainErrorFilter } from './auth-domain-error.filter';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

// Credential endpoints get tight per-IP limits (brute-force mitigation);
// refresh is a normal client operation and gets a looser one.
const CREDENTIAL_LIMIT = { default: { limit: 5, ttl: 60_000 } };
const REFRESH_LIMIT = { default: { limit: 20, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
@UseFilters(AuthDomainErrorFilter)
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly registerUser: RegisterUserUseCase,
    private readonly loginUseCase: LoginUseCase,
    private readonly refreshSession: RefreshSessionUseCase,
    private readonly logoutUseCase: LogoutUseCase,
    private readonly logger: Logger,
  ) {}

  @Post('register')
  @Throttle(CREDENTIAL_LIMIT)
  @ApiOperation({ summary: 'Create an account' })
  async register(@Body() dto: RegisterDto): Promise<RegisterUserOutput> {
    const result = await this.registerUser.execute(dto);
    this.logger.log({ event: 'auth.user_registered', userId: result.id });
    return result;
  }

  @Post('login')
  @HttpCode(200)
  @Throttle(CREDENTIAL_LIMIT)
  @ApiOperation({ summary: 'Exchange credentials for a session' })
  async login(@Body() dto: LoginDto): Promise<Session> {
    try {
      const session = await this.loginUseCase.execute(dto);
      this.logger.log({
        event: 'auth.login_succeeded',
        userId: session.user.id,
      });
      return session;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        // Security event; the email itself is deliberately not logged.
        this.logger.warn({ event: 'auth.login_failed' });
      }
      throw error;
    }
  }

  @Post('refresh')
  @HttpCode(200)
  @Throttle(REFRESH_LIMIT)
  @ApiOperation({ summary: 'Rotate the refresh token and get a new session' })
  async refresh(@Body() dto: RefreshTokenDto): Promise<Session> {
    try {
      return await this.refreshSession.execute(dto);
    } catch (error) {
      if (error instanceof RefreshTokenReuseError) {
        this.logger.warn({ event: 'auth.refresh_reuse_detected' });
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke a refresh token (idempotent)' })
  async logout(@Body() dto: RefreshTokenDto): Promise<void> {
    await this.logoutUseCase.execute(dto);
  }

  @Get('me')
  @UseGuards(JwtAccessGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Identity claims of the presented access token' })
  me(@Req() request: { user: AccessTokenPayload }): {
    id: string;
    email: string;
    roles: string[];
  } {
    const { sub, email, roles } = request.user;
    return { id: sub, email, roles };
  }
}
