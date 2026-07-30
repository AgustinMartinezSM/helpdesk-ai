import { REQUEST_ID_HEADER, TRACE_ID_HEADER } from '@helpdesk-ai/observability';

export const GATEWAY_CLIENT = Symbol('GATEWAY_CLIENT');

export interface UpstreamResponse {
  status: number;
  /** Parsed JSON body, or null for empty (e.g. 204) responses. */
  body: unknown;
}

export interface CorrelationHeaders {
  [REQUEST_ID_HEADER]?: string;
  [TRACE_ID_HEADER]?: string;
}

const UPSTREAM_TIMEOUT_MS = 5_000;

/**
 * Thin HTTP client for the routes exposed by the api-gateway. Uses Node's
 * built-in fetch; correlation headers from the incoming browser request are
 * forwarded so one traceId spans web -> bff -> gateway -> service.
 *
 * Network failures are surfaced as status 502 so the controller treats an
 * unreachable platform like any other upstream error.
 */
export class GatewayClient {
  constructor(private readonly gatewayUrl: string) {}

  request(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: {
      correlation: CorrelationHeaders;
      body?: unknown;
      authorization?: string;
    },
  ): Promise<UpstreamResponse> {
    return this.execute(method, path, options);
  }

  private async execute(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    options: {
      correlation: CorrelationHeaders;
      body?: unknown;
      authorization?: string;
    },
  ): Promise<UpstreamResponse> {
    const headers: Record<string, string> = { ...options.correlation };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options.authorization) {
      headers['authorization'] = options.authorization;
    }

    let response: Response;
    try {
      response = await fetch(`${this.gatewayUrl}${path}`, {
        method,
        headers,
        body:
          options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      // The message must fit every route this client serves — sessions,
      // tickets and AI suggestions all reach the platform through here.
      return {
        status: 502,
        body: {
          statusCode: 502,
          error: 'Bad Gateway',
          message: 'The platform is temporarily unavailable',
        },
      };
    }

    if (response.status === 204) {
      return { status: 204, body: null };
    }

    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    return { status: response.status, body };
  }
}
