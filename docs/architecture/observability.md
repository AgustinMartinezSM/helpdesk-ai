# Observability

Status as of Sprint 1 (2026-07-27). Implemented: structured JSON logging and request
correlation via `libs/observability` (`@helpdesk-ai/observability`), used by `apps/web-bff`
and `apps/api-gateway`. Everything else in this domain (metrics, dashboards, log
aggregation, distributed tracing) is planned and explicitly not built yet.

## Structured logging (Implemented)

Logging is provided by nestjs-pino 4.6.1 (pino 10, pino-http 11 pinned as peer
satisfiers), configured through a single dynamic module:

```ts
ObservabilityModule.forRoot({ serviceName, environment, logLevel });
```

Every log line is single-line JSON. Base fields present on all lines:

- `service` — the service name passed at bootstrap (e.g. `web-bff`, `api-gateway`)
- `environment` — the validated `NODE_ENV`

Request-scoped log lines additionally carry:

- `requestId`
- `traceId`
- `req` — `{ id, method, url }`
- `res` — `{ statusCode }`
- `responseTime` — milliseconds
- `msg` — `"request completed"`

Log level comes from the `LOG_LEVEL` environment variable (`fatal` … `trace`,
default `info`), validated by `@helpdesk-ai/configuration` before the app starts.

pino-pretty is intentionally deferred: logs stay JSON in development as well, so what
developers see locally is exactly what an aggregator would ingest later.

## What is deliberately kept out of logs (Implemented)

Two layers prevent sensitive data from reaching log output:

1. Minimal serializers. The `req` serializer emits only `id`, `method`, `url`; the
   `res` serializer emits only `statusCode`. Request and response headers and bodies
   are never serialized.
2. Redaction as a safety net. The pino `redact` list covers `authorization`,
   `cookie`, and `set-cookie`, so even if a future serializer change leaked headers,
   these values would be masked.

Do not log raw request objects, headers, or payloads from application code; the
serializers only protect what flows through pino-http.

## Request correlation (Implemented)

`correlationMiddleware` guarantees two headers on every request:

- `x-request-id` — honored if the client sends it; otherwise generated with
  `crypto.randomUUID()`.
- `x-trace-id` — honored if present; otherwise defaults to the request id.

Both headers are echoed on the response, so callers can always cite the ids for a
given request. The same values appear as `requestId` and `traceId` on the request's
log lines, which is what makes a single request's logs greppable within one service.

Behavior is covered by unit tests (middleware) and by supertest integration tests
against a real Nest app instance that verify the header echo.

## Request correlation is not distributed tracing

The correlation ids above are exactly that: ids attached to logs. This is not
distributed tracing, and the codebase does not claim to have tracing. Specifically,
there are:

- No spans — no timed, nested units of work; only one flat log line per request.
- No sampling — every request is logged at the configured level; there is no
  head- or tail-based sampling decision.
- No W3C Trace Context — `x-trace-id` is a plain UUID header, not a `traceparent`
  header, and carries no vendor flags or parent span id.
- No cross-service context propagation — nothing forwards trace context through
  HTTP calls to downstream services or through RabbitMQ message headers, because no
  downstream services or event flows exist yet.

Real distributed tracing (spans, sampling policy, W3C `traceparent`, propagation
through both HTTP and RabbitMQ headers) is planned and will be designed separately
once more than one service participates in a request. The correlation middleware is
sized for what exists today and will be revisited by that design, not extended ad hoc.

## Fail-fast configuration logging (Implemented)

Both Nest apps validate `process.env` with `validateEnv` from
`@helpdesk-ai/configuration` before `NestFactory.create` runs. On invalid
configuration the process prints one `EnvValidationError` listing every offending
variable — not just the first — and exits with code 1. This is verified behavior.
Nothing partially boots with bad config, so log output never mixes lines from a
misconfigured instance.

Bootstrap also uses `bufferLogs` with the pino logger, so early framework logs are
emitted through the same JSON pipeline instead of the default Nest console logger.

## Planned

- Metrics — no metrics endpoint or collection exists.
- Dashboards — nothing to build on until metrics exist.
- Log aggregation — logs currently go to stdout only; no shipper or store is
  configured.
- Distributed tracing — separate design, see the section above.
