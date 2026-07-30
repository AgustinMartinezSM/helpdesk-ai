# Observability

Status as of Sprint 9.2 (2026-07-30). Implemented: structured JSON logging and request
correlation via `libs/observability` (`@helpdesk-ai/observability`), used by all ten
Nest apps, and the request trace id carried onto every published event. Everything else
in this domain (metrics, dashboards, log aggregation, distributed tracing) is planned
and explicitly not built yet.

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

## Correlation on published events (Implemented)

Since Sprint 9.2 (commit `3a913f0`) all three publishers — auth-service,
tickets-service and ai-service — pass the request's trace id as the envelope's
`correlationId`, so it reaches the broker with every event. Before that change
every envelope carried none, and a row written by a consumer could not be joined
back to the request that caused it; audit-service persists the value on the audit
row, which is what makes that join possible.

The id travels on the envelope, never in the payload: it says which request
produced the event, which is a fact about the request rather than about the
ticket or the user. It is threaded explicitly, as an optional last argument on
the use cases that publish, rather than through an ambient request-scoped store.
Optional at every step, deliberately — a missing trace must never stop a domain
event from being published.

## Request correlation is not distributed tracing

The correlation ids above are exactly that: ids attached to logs. This is not
distributed tracing, and the codebase does not claim to have tracing. Specifically,
there are:

- No spans — no timed, nested units of work; only one flat log line per request.
- No sampling — every request is logged at the configured level; there is no
  head- or tail-based sampling decision.
- No W3C Trace Context — `x-trace-id` is a plain UUID header, not a `traceparent`
  header, and carries no vendor flags or parent span id.
- No uniform context propagation — the ids do travel, but each hop carries them
  by hand. web-bff copies `x-request-id` and `x-trace-id` onto its calls to the
  api-gateway, the gateway proxies headers untouched to the seven services it
  routes, ai-service forwards them on its direct call to tickets-service, and the
  trace id is stamped onto published events (section above). auth-service does not
  send them on its direct call to organizations-service, and nothing makes a new
  call site carry them — there is no propagator, only a convention.
- No way to follow one id across services — logs go to stdout per process and
  nothing aggregates them, so a trace id spanning three services means reading
  three services' output separately.

Real distributed tracing (spans, sampling policy, W3C `traceparent`, propagation
through both HTTP and RabbitMQ headers) is planned and will be designed separately.
Several services now participate in a single request, which is what makes that
design worth doing rather than premature. The correlation middleware is sized for
what exists today and will be revisited by that design, not extended ad hoc.

## Fail-fast configuration logging (Implemented)

All ten Nest apps validate `process.env` with `validateEnv` from
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
