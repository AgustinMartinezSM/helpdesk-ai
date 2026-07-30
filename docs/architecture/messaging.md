# Messaging

Status: implemented in Sprint 6 (ADR 0005), consumers completed in Sprint 7
(ADR 0006), with `organizations-service` added as a consumer in Sprint 9.2.
Broker: RabbitMQ 4.3 from `compose.yaml` (management UI on
http://localhost:15672).

## Topology

```
                        routing key = event type
  producers ──────────▶ helpdesk.events (topic, durable)
                          │  binding per consumed type
                          ▼
                <service>.<purpose> (durable queue)
                          │  nack (no requeue: bad JSON, contract
                          │  violation, handler error)
                          ▼
                helpdesk.events.dlx (direct, durable)
                          │  routing key = queue name
                          ▼
                <service>.<purpose>.dlq  (inspection + manual replay)
```

- One shared topic exchange, `helpdesk.events`; the routing key of a
  message is exactly its event type, so consumers can bind precise types
  (`user.registered.v1`) or families (`ticket.*.v1`).
- Each consuming service owns its durable queue and its `.dlq`:
  `users-service.user-registered`, `organizations-service.user-registered`,
  `audit-service.event-log` (binding `#`),
  `notification-service.ticket-events`, `analytics-service.metrics`.
- Delivery is at-least-once and there is no automatic retry: handlers must
  be idempotent, and rejected messages dead-letter immediately.
- notification-service and analytics-service consume with `prefetch: 1`:
  serialized handling guarantees a ticket's `created` event is projected
  before follow-up events of the same ticket are dispatched.

## Contracts (`@helpdesk-ai/messaging`)

Contracts are zod schemas versioned in the event name; the envelope is
`{ id (uuid), type, occurredAt (ISO), correlationId?, payload }`. Producers
validate before publishing (a malformed event is a bug in the producer);
consumers validate envelope and payload before the handler runs.

| Event                      | Producer        | Consumers                                      |
| -------------------------- | --------------- | ---------------------------------------------- |
| `user.registered.v1`       | auth-service    | users-service, organizations, analytics, audit |
| `ticket.created.v1`        | tickets-service | notification (ref), analytics, audit           |
| `ticket.status-changed.v1` | tickets-service | notification, analytics, audit                 |
| `ticket.assigned.v1`       | tickets-service | notification, audit                            |
| `ticket.comment-added.v1`  | tickets-service | notification, audit                            |
| `ai.suggestion.created.v1` | ai-service      | audit (firehose only)                          |

(audit-service does not bind individual types: its `#` firehose captures
every event on the exchange, present and future — which is why
`ai.suggestion.created.v1` needed no consumer work in Sprint 8.)

`organizations-service` started consuming `user.registered.v1` in Sprint 9.2,
the third service to bind that type after users-service and
analytics-service, and on a queue of its own — so both of them keep receiving
the event untouched. It creates the membership that places a new user in an
organization, and it publishes nothing: membership lifecycle events are a
later phase.

`ai-service` publishes and consumes nothing: it owns no queue. Its work is
request-driven (ADR 0011), so the event exists to record that a suggestion
happened, not to trigger anything.

Changing a payload shape = new `v2` contract published alongside `v1` until
every consumer migrates. `v1` is never mutated.

**Content rule**: event payloads carry identifiers and metadata — NEVER
credentials, tokens, secrets or user-authored free text (comment bodies,
internal notes). Everything published lands verbatim in the audit trail
and stays there; this rule is part of reviewing any new contract. The rule
extends to model output: `ai.suggestion.created.v1` names the provider,
model and task but carries no summary, rationale or draft.

**Firehose rule**: `subscribeFirehose` (envelope-only validation, opaque
payloads) exists exclusively for schema-on-read consumers — today only
audit-service. Every domain consumer uses `subscribe()` with explicit
contracts, keeping payload validation and drift detection intact.

## Client behavior

`MessagingClient` (amqplib + amqp-connection-manager) reconnects
automatically, re-runs topology setup and re-subscribes consumers after a
broker restart, and resolves `publish()` only on broker confirm (publishes
made while disconnected are buffered). Publishing adapters in services are
best-effort by contract: the primary write already committed, so broker
failures are logged, never breaking the request (no outbox yet — ADR 0005
records when that trade-off must be revisited).

That trade-off costs the most on `user.registered.v1`: a membership is not a
rebuildable projection (ADR 0013), so an event that was never published
leaves a user belonging to no organization and there is nothing to replay.
The recovery path is an operator script,
`infrastructure/postgres/operations/backfill-bootstrap-memberships.sh` —
`data-ownership.md` explains why it is the only one.

users-service starts its subscription fire-and-forget on bootstrap: a
broker outage delays consumption instead of blocking HTTP reads, and the
profile projection catches up when the broker returns (`GET /users/me`
answers 404 until then — eventual consistency is part of the API contract).

## Local inspection

- Management UI: http://localhost:15672 (credentials in `.env.example`).
- DLQs are plain queues: `users-service.user-registered.dlq` holds every
  message that failed decoding or handling, untouched, for manual replay.
