import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { REQUEST_ID_HEADER, TRACE_ID_HEADER } from '@helpdesk-ai/observability';
import { APP_ENV, type WebBffEnv } from '../../config/env';
import { readCookie } from './cookies';
import {
  GATEWAY_AUTH_CLIENT,
  GatewayAuthClient,
  type CorrelationHeaders,
  type UpstreamResponse,
} from './gateway-auth.client';
import { LoginDto } from './dto/login.dto';

export const REFRESH_COOKIE = 'helpdesk_refresh';

interface BrowserRequest {
  headers: Record<string, string | undefined>;
}

interface CookieResponse {
  cookie(
    name: string,
    value: string,
    options: Record<string, unknown>,
  ): unknown;
  clearCookie(name: string, options: Record<string, unknown>): unknown;
}

interface UpstreamSession {
  accessToken: string;
  expiresInSeconds: number;
  refreshToken: string;
  user: { id: string; email: string; roles: string[] };
}

/**
 * Browser-facing session endpoints.
 *
 * The BFF is the only place that ever handles the refresh token on the web
 * path: it lives in an httpOnly cookie scoped to /session, so page scripts
 * (and XSS payloads) cannot read it. The short-lived access token is the
 * only credential handed to browser JavaScript.
 */
@Controller('session')
export class SessionController {
  constructor(
    @Inject(GATEWAY_AUTH_CLIENT) private readonly gateway: GatewayAuthClient,
    @Inject(APP_ENV) private readonly env: WebBffEnv,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: LoginDto,
    @Req() req: BrowserRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<unknown> {
    const upstream = await this.gateway.request('POST', '/api/auth/login', {
      correlation: correlationOf(req),
      body: dto,
    });
    const session = this.expectSession(upstream);
    this.setRefreshCookie(res, session.refreshToken);
    return toBrowserSession(session);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: BrowserRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<unknown> {
    const refreshToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException('No active session');
    }

    const upstream = await this.gateway.request('POST', '/api/auth/refresh', {
      correlation: correlationOf(req),
      body: { refreshToken },
    });
    if (upstream.status === 401) {
      // Expired, revoked or reused server-side: the cookie is dead weight.
      this.clearRefreshCookie(res);
    }
    const session = this.expectSession(upstream);
    this.setRefreshCookie(res, session.refreshToken);
    return toBrowserSession(session);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: BrowserRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<void> {
    const refreshToken = readCookie(req.headers.cookie, REFRESH_COOKIE);
    if (refreshToken) {
      // Best effort: the cookie is cleared regardless of upstream health,
      // and auth-side logout is idempotent anyway.
      await this.gateway.request('POST', '/api/auth/logout', {
        correlation: correlationOf(req),
        body: { refreshToken },
      });
    }
    this.clearRefreshCookie(res);
  }

  @Get('me')
  async me(@Req() req: BrowserRequest): Promise<unknown> {
    const upstream = await this.gateway.request('GET', '/api/auth/me', {
      correlation: correlationOf(req),
      authorization: req.headers.authorization,
    });
    if (upstream.status !== 200) {
      throw new HttpException(
        upstream.body ?? { statusCode: upstream.status },
        upstream.status,
      );
    }
    return upstream.body;
  }

  private expectSession(upstream: UpstreamResponse): UpstreamSession {
    if (upstream.status !== 200) {
      throw new HttpException(
        upstream.body ?? { statusCode: upstream.status },
        upstream.status,
      );
    }
    return upstream.body as UpstreamSession;
  }

  private setRefreshCookie(res: CookieResponse, refreshToken: string): void {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.SESSION_COOKIE_SECURE,
      path: '/session',
      maxAge: this.env.SESSION_REFRESH_COOKIE_MAX_AGE_SECONDS * 1000,
    });
  }

  private clearRefreshCookie(res: CookieResponse): void {
    res.clearCookie(REFRESH_COOKIE, { path: '/session' });
  }
}

function correlationOf(req: BrowserRequest): CorrelationHeaders {
  const headers: CorrelationHeaders = {};
  const requestId = req.headers[REQUEST_ID_HEADER];
  const traceId = req.headers[TRACE_ID_HEADER];
  if (requestId) {
    headers[REQUEST_ID_HEADER] = requestId;
  }
  if (traceId) {
    headers[TRACE_ID_HEADER] = traceId;
  }
  return headers;
}

/** Strips the refresh token: it must never reach browser JavaScript. */
function toBrowserSession(session: UpstreamSession): unknown {
  return {
    accessToken: session.accessToken,
    expiresInSeconds: session.expiresInSeconds,
    user: session.user,
  };
}
