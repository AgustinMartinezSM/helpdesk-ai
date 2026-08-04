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
import { ChooseOrganizationDto } from './dto/choose-organization.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

export const REFRESH_COOKIE = 'helpdesk_refresh';

/**
 * Which organization this browser last chose (Sprint 10.6, ADR 0025).
 *
 * It only ASKS. Every mint validates it against the caller's stored membership
 * upstream and refuses or falls back, so a tampered value can request
 * something and be told no — categorically unlike the `x-organization-id`
 * header ADR 0014 rejected, where a downstream service would have trusted it.
 *
 * httpOnly anyway, and scoped to `/session` beside the refresh credential:
 * page scripts have no reason to read it, and the only requests that need it
 * are the ones that mint.
 *
 * It is deliberately NOT a column on `refresh_tokens`. ADR 0014 settled that
 * table's shape — a session belongs to a person — and reopening that in the
 * sprint that finally implements the rest of that record is how a decision
 * record stops being trustworthy. The cost is that a second device starts from
 * the default rule, which is stated rather than hidden.
 */
export const ORGANIZATION_COOKIE = 'helpdesk_org';

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
    // A fresh sign-in starts from the default rule, deterministically.
    // Honouring a remembered choice here would make a credential exchange
    // depend on browser state, and honouring it only on the NEXT refresh
    // would land somebody in one organization and move them seconds later.
    // Clearing is the version with no flicker (ADR 0025).
    this.clearOrganizationCookie(res);
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

    // The remembered choice travels with the rotation. Upstream validates it
    // and falls back if it cannot be honoured, so this is a request rather
    // than an instruction.
    const organizationId = readCookie(req.headers.cookie, ORGANIZATION_COOKIE);

    const upstream = await this.gateway.request('POST', '/api/auth/refresh', {
      correlation: correlationOf(req),
      body: { refreshToken, ...(organizationId ? { organizationId } : {}) },
    });
    if (upstream.status === 401) {
      // Expired, revoked or reused server-side: both cookies are dead weight.
      this.clearRefreshCookie(res);
      this.clearOrganizationCookie(res);
    }
    const session = this.expectSession(upstream);
    this.setRefreshCookie(res, session.refreshToken);
    // Rewritten to what actually came back, which is how a stale choice
    // corrects itself: somebody removed from the organization they remembered
    // gets the default one here and stops asking for the other. Never a
    // failure — a refresh is how a session survives, and it must not be the
    // thing that ends one.
    this.rememberOrganization(res, session.organizationId);
    return toBrowserSession(session);
  }

  /**
   * Switching organizations — the browser-facing half of the token exchange.
   *
   * Under `/session` because that is where the cookies live: the refresh
   * cookie's path scopes it here, and the organization cookie sits beside it.
   * It returns a session shape with no refresh credential, because upstream
   * mints no new one — the person's session is untouched, only their context
   * changed (ADR 0025).
   */
  @Post('organization')
  @HttpCode(200)
  async chooseOrganization(
    @Body() dto: ChooseOrganizationDto,
    @Req() req: BrowserRequest,
    @Res({ passthrough: true }) res: CookieResponse,
  ): Promise<unknown> {
    const upstream = await this.gateway.request(
      'POST',
      '/api/auth/session/organization',
      {
        correlation: correlationOf(req),
        authorization: req.headers.authorization,
        body: { organizationId: dto.organizationId },
      },
    );
    if (upstream.status !== 200) {
      // Forwarded verbatim. A 404 means "not available to this account" and
      // is blind to why on purpose; rewriting it here would invent a
      // distinction the service refused to make.
      throw new HttpException(
        upstream.body ?? { statusCode: upstream.status },
        upstream.status,
      );
    }

    const session = upstream.body as UpstreamSession;
    // Remembered only AFTER the server agreed. Writing the cookie first would
    // leave a browser asking for an organization it was just refused.
    this.rememberOrganization(res, session.organizationId);
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
    this.clearOrganizationCookie(res);
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

  /**
   * Records what the server actually minted, or clears the cookie when it
   * minted nothing tenanted. Never records what was ASKED for — that is the
   * difference between a remembered choice and a browser insisting.
   */
  private rememberOrganization(
    res: CookieResponse,
    organizationId: string | null,
  ): void {
    if (!organizationId) {
      this.clearOrganizationCookie(res);
      return;
    }
    res.cookie(ORGANIZATION_COOKIE, organizationId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.env.SESSION_COOKIE_SECURE,
      // Beside the refresh credential, and for the same reason: the only
      // requests that need it are the ones that mint.
      path: '/session',
      maxAge: this.env.SESSION_REFRESH_COOKIE_MAX_AGE_SECONDS * 1000,
    });
  }

  private clearOrganizationCookie(res: CookieResponse): void {
    res.clearCookie(ORGANIZATION_COOKIE, { path: '/session' });
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
