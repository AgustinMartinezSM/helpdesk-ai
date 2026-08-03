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
  GATEWAY_CLIENT,
  GatewayClient,
  type CorrelationHeaders,
  type UpstreamResponse,
} from '../gateway.client';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

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
  /** Permission keys the token carries, echoed for rendering (ADR 0020). */
  permissions: string[];
  organizationId: string | null;
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
    @Inject(GATEWAY_CLIENT) private readonly gateway: GatewayClient,
    @Inject(APP_ENV) private readonly env: WebBffEnv,
  ) {}

  /**
   * Creates an account. Deliberately does NOT sign anyone in.
   *
   * The product wants register-then-redeem to feel like one step, but chaining
   * the login here would put a credential decision in the BFF, which has never
   * made one. The page issues the two calls instead: that keeps the sequence a
   * UX choice, keeps auth-service's throttle counting both attempts
   * separately, and means a login failure after a successful registration is
   * a recoverable state the person can see rather than a half-finished
   * transaction hidden inside one response.
   *
   * No cookie is set: there is no session yet.
   */
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: BrowserRequest,
  ): Promise<unknown> {
    const upstream = await this.gateway.request('POST', '/api/auth/register', {
      correlation: correlationOf(req),
      body: dto,
    });
    if (upstream.status < 200 || upstream.status >= 300) {
      throw new HttpException(
        upstream.body ?? { statusCode: upstream.status },
        upstream.status,
      );
    }
    return upstream.body;
  }

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
    // The BFF forwarded the flag itself, so deciding the cookie shape from
    // the request is honest — no upstream field needed to echo it back.
    this.setRefreshCookie(res, session.refreshToken, {
      sessionScoped: dto.sharedWorkstation === true,
    });
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

  private setRefreshCookie(
    res: CookieResponse,
    refreshToken: string,
    options: { sessionScoped?: boolean } = {},
  ): void {
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.SESSION_COOKIE_SECURE,
      path: '/session',
      // On a shared workstation the cookie carries no Max-Age at all: it
      // dies with the browser, so closing the till's window ends the
      // session locally while the shortened upstream TTL bounds it anyway.
      ...(options.sessionScoped
        ? {}
        : { maxAge: this.env.SESSION_REFRESH_COOKIE_MAX_AGE_SECONDS * 1000 }),
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

/**
 * Strips the refresh token: it must never reach browser JavaScript.
 *
 * Everything else passes through, including the permission keys (ADR 0020) —
 * they say nothing the access token in the same response does not already
 * assert, and the browser holds that token. This is an allowlist rather than
 * a delete so a field added upstream is dropped until someone decides it
 * belongs in a browser.
 */
function toBrowserSession(session: UpstreamSession): unknown {
  return {
    accessToken: session.accessToken,
    expiresInSeconds: session.expiresInSeconds,
    permissions: session.permissions ?? [],
    organizationId: session.organizationId ?? null,
    user: session.user,
  };
}
