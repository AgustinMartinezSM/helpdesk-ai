# Messaging

Status: implemented in Sprint 6 (ADR 0005), consumers completed in Sprint 7
(ADR 0006), with `organizations-service` added as a consumer in Sprint 9.2 and
a `v2` compatibility window opened in Sprint 9.3.
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
- Sprint 9.3 created no queue and no binding. The five `v2` contracts
  publish onto the same exchange, and every binding key above is an exact
  literal except audit's `#` — in a topic exchange `.` is the word
  separator, so a `ticket.created.v1` binding does not match a
  `ticket.created.v2` message.
- Delivery is at-least-once and there is no automatic retry: handlers must
  be idempotent, and rejected messages dead-letter immediately.
- notification-service and analytics-service consume with `prefetch: 1`:
  serialized handling guarantees a ticket's `created` event is projected
  before follow-up events of the same ticket are dispatched.

## Contracts (`@helpdesk-ai/messaging`)

Contracts are zod schemas versioned in the event name; the envelope is
`{ id (uuid), type, occurredAt (ISO), correlationId?, organizationId?, payload }`.
Producers validate before publishing (a malformed event is a bug in the
producer); consumers validate envelope and payload before the handler runs.

| Event                      | Producer        | Consumers                                      |
| -------------------------- | --------------- | ---------------------------------------------- |
| `user.registered.v1`       | auth-service    | users-service, organizations, analytics, audit |
| `ticket.created.v1`        | tickets-service | notification (ref), analytics, audit           |
| `ticket.created.v2`        | tickets-service | audit only, via the firehose — no queue binds  |
| `ticket.status-changed.v1` | tickets-service | notification, analytics, audit                 |
| `ticket.status-changed.v2` | tickets-service | audit only, via the firehose — no queue binds  |
| `ticket.assigned.v1`       | tickets-service | notification, audit                            |
| `ticket.assigned.v2`       | tickets-service | audit only, via the firehose — no queue binds  |
| `ticket.comment-added.v1`  | tickets-service | notification, audit                            |
| `ticket.comment-added.v2`  | tickets-service | audit only, via the firehose — no queue binds  |
| `ai.suggestion.created.v1` | ai-service      | audit (firehose only)                          |
| `ai.suggestion.created.v2` | ai-service      | audit only, via the firehose — no queue binds  |

(audit-service does not bind individual types: its `#` firehose captures
every event on the exchange, present and future — which is why
`ai.suggestion.created.v1` needed no consumer work in Sprint 8, and why the
five `v2` contracts needed none in Sprint 9.3.)

That has a cost for as long as both versions are published, and the
arithmetic is simple: 1 logical fact = 2 publishes, both match `#`, = 2 audit
rows. The id-keyed dedupe cannot collapse them — it collapses a redelivery of
one envelope, and these are two envelopes with two random ids. The `type`
column tells them apart, and the shared `correlationId` is the only thing that
groups them back into one request. Anything counting audit rows per logical
fact double-counts for the whole window. An integration test pins this as
intended behaviour rather than leaving phase 4 to discover it.

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

One such window is open, and it is worth stating what that looks like in
practice. Sprint 9.3 (phase 3 of the tenancy migration) gave the five
contracts above a `v2` whose envelope carries the tenant. Both versions go out
on every publish, `v1` unchanged; nothing consumes a `v2` yet, which is the
point of the checkpoint. The window closes in phase 8, when `v1` stops being
published because every consumer reads `v2` — the whole span is the reason the
pairs must not drift.

They cannot: each `v1`/`v2` pair shares one payload schema _object_, extracted
to a module-level const in `contracts.ts` and handed to both `defineEvent`
calls. The payloads are identical by construction rather than by discipline,
and the test asserts the identity (`v2.payloadSchema === v1.payloadSchema`)
instead of comparing two shapes that could both be edited. The only
differences within a pair are the type string — which is the routing key — and
the tenant on the envelope.

That tenant is `organizationId`, on the envelope next to `correlationId`,
never in a payload. Each contract names its subject differently (`ticketId`,
`userId`, `suggestionId`) and audit-service decodes events it has no schema
for, so a payload field would be invisible to exactly the consumer that most
needs it — the same problem R4 records about backfilling `audit_events`. On
the envelope it is in one place for every contract and the firehose reads it
without knowing any of them. It is _optional_ on `eventEnvelopeSchema` because
that schema is shared by every version of every event and still has to accept
every `v1` message unchanged; "required" is a property of the v2 publish path,
not of the schema. (It had to be declared there regardless: zod strips unknown
keys, so an undeclared field would be dropped silently at every consumer.)

`user.registered` has no `v2` and cannot have one. Registration is anonymous,
and the membership that would supply a tenant is created by _consuming_ that
event — organizations-service resolves the bootstrap slug on the consumer side
— so a required tenant there is structurally unsatisfiable. It stays
tenant-free. This is a documented exception, not an oversight; the follow-up
is membership lifecycle events published by organizations-service, which is a
later phase.

A `v2` is published only when the caller's organization is known. Otherwise
the publishing adapter logs a warning naming the contract and the subject id,
and skips it. Tenant resolution fails open (Sprint 9.2), so a token minted
during an organizations-service outage carries no tenant, and neither does one
for a user whose membership has not been backfilled — publishing a tenant-free
`v2` would produce exactly the message the next phase is meant to reject, and
the skip has to be visible to an operator before that happens. Nothing in
`@helpdesk-ai/messaging` can enforce this: `buildEnvelope` validates payloads
and never envelopes, so the guard is explicit in each publishing adapter. The
two publishes are independent best-effort calls — one failing does not
suppress the other — and both carry the same `correlationId`. On ticket events
the organization is the caller's, not the ticket's: tickets have no
organization column until phase 4, which has to reconcile the two.

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
