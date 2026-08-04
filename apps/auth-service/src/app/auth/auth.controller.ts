import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Logger, TRACE_ID_HEADER } from '@helpdesk-ai/observability';
import {
  InvalidCredentialsError,
  RefreshTokenReuseError,
} from '../../domain/errors';
import type { AccessSession, Session } from '../../application/session.service';
import {
  GetIdentityUseCase,
  type IdentityOutput,
} from '../../application/use-cases/get-identity';
import { LoginUseCase } from '../../application/use-cases/login';
import { LogoutUseCase } from '../../application/use-cases/logout';
import { ExchangeOrganizationUseCase } from '../../application/use-cases/exchange-organization';
import { RefreshSessionUseCase } from '../../application/use-cases/refresh-session';
import {
  RegisterUserUseCase,
  type RegisterUserOutput,
} from '../../application/use-cases/register-user';
import { JwtAccessGuard, type AccessTokenPayload } from '@helpdesk-ai/security';
import { AuthDomainErrorFilter } from './auth-domain-error.filter';
import { LoginDto } from './dto/login.dto';
import {
  ExchangeOrganizationDto,
  RefreshSessionDto,
  RefreshTokenDto,
} from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

// Credential endpoints get tight per-IP limits (brute-force mitigation);
// refresh is a normal client operation and gets a looser one.
const CREDENTIAL_LIMIT = { default: { limit: 5, ttl: 60_000 } };
const REFRESH_LIMIT = { default: { limit: 20, ttl: 60_000 } };
// Switching is a normal client operation, but it also answers 404 for any
// organization the caller does not hold — so it is bounded rather than left
// open to somebody walking ids looking for a 200.
const EXCHANGE_LIMIT = { default: { limit: 20, ttl: 60_000 } };

interface CorrelatedRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * The trace id of the request about to cause a domain event.
 * `correlationMiddleware` guarantees the header on every inbound request, so
 * the undefined branch only covers a caller that bypassed it.
 */
function traceIdOf(req: CorrelatedRequest): string | undefined {
  const value = req.headers[TRACE_ID_HEADER];
  return Array.isArray(value) ? value[0] : value;
}

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
    private readonly getIdentity: GetIdentityUseCase,
    private readonly exchange: ExchangeOrganizationUseCase,
    private readonly logger: Logger,
  ) {}

  @Post('register')
  @Throttle(CREDENTIAL_LIMIT)
  @ApiOperation({ summary: 'Create an account' })
  async register(
    @Req() req: CorrelatedRequest,
    @Body() dto: RegisterDto,
  ): Promise<RegisterUserOutput> {
    const result = await this.registerUser.execute(dto, traceIdOf(req));
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
  async refresh(@Body() dto: RefreshSessionDto): Promise<Session> {
    try {
      return await this.refreshSession.execute(dto);
    } catch (error) {
      if (error instanceof RefreshTokenReuseError) {
        this.logger.warn({ event: 'auth.refresh_reuse_detected' });
      }
      throw error;
    }
  }

  /**
   * The token exchange ADR 0014 described in Sprint 9.1 and left unbuilt.
   *
   * Guarded by the access token rather than the refresh credential, because
   * switching context is not starting a session: nothing here touches
   * `refresh_tokens`, so the born window and reuse detection stay out of the
   * switching path (ADR 0025). The response is a session MINUS the refresh
   * credential, and the client keeps the one it already has.
   *
   * Its own throttle. Inheriting the refresh limit would let a burst of
   * switches consume a person's refresh budget, and inheriting nothing would
   * leave a membership-probing endpoint unlimited — it answers 404 for
   * anything not held, so an unbounded caller could walk organization ids
   * looking for a 200.
   */
  @Post('session/organization')
  @HttpCode(200)
  @UseGuards(JwtAccessGuard)
  @Throttle(EXCHANGE_LIMIT)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Swap your token for one acting in another organization you hold',
  })
  async exchangeOrganization(
    @Req() request: { user: AccessTokenPayload },
    @Body() dto: ExchangeOrganizationDto,
  ): Promise<AccessSession> {
    // The caller is the VERIFIED token. A body field naming a user would let
    // anybody holding an account mint a token for somebody else.
    const exchanged = await this.exchange.execute({
      userId: request.user.sub,
      organizationId: dto.organizationId,
    });
    this.logger.log({
      event: 'auth.organization_exchanged',
      userId: request.user.sub,
      organizationId: exchanged.organizationId,
    });
    return exchanged;
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
  @ApiOperation({ summary: 'Identity of the authenticated account' })
  async me(
    @Req() request: { user: AccessTokenPayload },
  ): Promise<IdentityOutput> {
    // The token proves who is asking; the user row supplies what the answer
    // says. Since phase 8 the token carries no roles claim, so the response's
    // role names — unchanged in shape, apps/web renders them — are loaded
    // rather than echoed. A token whose account is gone gets a 401, not an
    // identity reconstructed from stale claims.
    //
    // Permissions go the other way and ARE echoed (ADR 0020): this endpoint
    // answers about the token presented, so re-resolving could describe a
    // membership that token does not carry, and it would put a second
    // organizations-service call on the cheapest endpoint in the service.
    const identity = await this.getIdentity.execute(request.user.sub, {
      permissions: request.user.perms ?? [],
      organizationId: request.user.org ?? null,
    });
    if (!identity) {
      throw new UnauthorizedException();
    }
    return identity;
  }
}
