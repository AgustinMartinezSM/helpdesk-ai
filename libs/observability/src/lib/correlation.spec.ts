import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  correlationMiddleware,
  REQUEST_ID_HEADER,
  TRACE_ID_HEADER,
} from './correlation.js';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface TestExchange {
  req: IncomingMessage;
  res: ServerResponse;
  responseHeaders: Record<string, string>;
  next: jest.Mock;
}

function buildExchange(headers: Record<string, string> = {}): TestExchange {
  const responseHeaders: Record<string, string> = {};
  const req = { headers: { ...headers } } as unknown as IncomingMessage;
  const res = {
    setHeader(name: string, value: string) {
      responseHeaders[name] = value;
    },
  } as unknown as ServerResponse;

  return { req, res, responseHeaders, next: jest.fn() };
}

describe('correlationMiddleware', () => {
  it('generates a request id when the client does not send one', () => {
    const { req, res, responseHeaders, next } = buildExchange();

    correlationMiddleware(req, res, next);

    expect(req.headers[REQUEST_ID_HEADER]).toMatch(UUID_PATTERN);
    expect(responseHeaders[REQUEST_ID_HEADER]).toBe(
      req.headers[REQUEST_ID_HEADER],
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves an incoming request id instead of overwriting it', () => {
    const { req, res, responseHeaders, next } = buildExchange({
      [REQUEST_ID_HEADER]: 'client-supplied-id',
    });

    correlationMiddleware(req, res, next);

    expect(req.headers[REQUEST_ID_HEADER]).toBe('client-supplied-id');
    expect(responseHeaders[REQUEST_ID_HEADER]).toBe('client-supplied-id');
  });

  it('starts a new trace from the request id when no trace id arrives', () => {
    const { req, res, responseHeaders, next } = buildExchange();

    correlationMiddleware(req, res, next);

    expect(req.headers[TRACE_ID_HEADER]).toBe(req.headers[REQUEST_ID_HEADER]);
    expect(responseHeaders[TRACE_ID_HEADER]).toBe(
      responseHeaders[REQUEST_ID_HEADER],
    );
  });

  it('propagates an incoming trace id across a new request id', () => {
    const { req, res, responseHeaders, next } = buildExchange({
      [TRACE_ID_HEADER]: 'trace-from-upstream',
    });

    correlationMiddleware(req, res, next);

    expect(req.headers[TRACE_ID_HEADER]).toBe('trace-from-upstream');
    expect(responseHeaders[TRACE_ID_HEADER]).toBe('trace-from-upstream');
    expect(req.headers[REQUEST_ID_HEADER]).not.toBe('trace-from-upstream');
  });
});
