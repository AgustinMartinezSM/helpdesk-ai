import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';
import { REQUEST_ID_HEADER, TRACE_ID_HEADER } from './correlation.js';

export interface ObservabilityOptions {
  /** Logical service name stamped on every log line (e.g. "web-bff"). */
  serviceName: string;
  /** Runtime environment stamped on every log line (e.g. "development"). */
  environment: string;
  /** Minimum pino level to emit (e.g. "info"). */
  logLevel: string;
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Structured JSON logging for HTTP services, built on nestjs-pino.
 *
 * Every request log line carries: service, environment, requestId, traceId,
 * method, url, status code and duration (pino-http responseTime). Request and
 * response serializers are intentionally minimal so headers and bodies never
 * reach the logs; the redact list is a safety net on top of that.
 */
@Module({})
export class ObservabilityModule {
  static forRoot(options: ObservabilityOptions): DynamicModule {
    return {
      module: ObservabilityModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: options.logLevel,
            // correlationMiddleware normally runs first and sets this header;
            // the fallback keeps ids present even if it is not registered.
            genReqId: (req: IncomingMessage) =>
              headerValue(req, REQUEST_ID_HEADER) ?? randomUUID(),
            // service/environment come from `base` below; here only the
            // per-request identifiers are added.
            customProps: (req: IncomingMessage) => ({
              requestId: headerValue(req, REQUEST_ID_HEADER),
              traceId: headerValue(req, TRACE_ID_HEADER),
            }),
            serializers: {
              req(req: { id: unknown; method: string; url: string }) {
                return { id: req.id, method: req.method, url: req.url };
              },
              res(res: ServerResponse) {
                return { statusCode: res.statusCode };
              },
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                "req.headers['set-cookie']",
              ],
              remove: true,
            },
            base: {
              service: options.serviceName,
              environment: options.environment,
            },
          },
        }),
      ],
      exports: [LoggerModule],
    };
  }
}
