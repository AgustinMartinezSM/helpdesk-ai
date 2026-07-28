import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export const REQUEST_ID_HEADER = 'x-request-id';
export const TRACE_ID_HEADER = 'x-trace-id';

function firstHeaderValue(
  req: IncomingMessage,
  name: string,
): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

/**
 * Express-compatible middleware that guarantees correlation identifiers.
 *
 * - requestId identifies one HTTP request handled by one service.
 * - traceId follows a user action across services; callers propagate it,
 *   and when a request enters the platform without one it starts a new trace.
 *
 * Both are echoed back as response headers so clients and upstream services
 * can reference them in bug reports and follow-up calls.
 *
 * This is request correlation only. It is NOT distributed tracing: there are
 * no spans, no sampling and no W3C traceparent propagation. Real tracing will
 * be designed separately (see docs/architecture/observability.md).
 */
export function correlationMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
): void {
  const requestId = firstHeaderValue(req, REQUEST_ID_HEADER) ?? randomUUID();
  const traceId = firstHeaderValue(req, TRACE_ID_HEADER) ?? requestId;

  // Normalize onto the request so downstream consumers (pino-http, handlers)
  // read one consistent value regardless of what the client sent.
  req.headers[REQUEST_ID_HEADER] = requestId;
  req.headers[TRACE_ID_HEADER] = traceId;

  res.setHeader(REQUEST_ID_HEADER, requestId);
  res.setHeader(TRACE_ID_HEADER, traceId);

  next();
}
