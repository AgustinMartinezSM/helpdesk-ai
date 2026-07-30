# ADR 0005 — Asynchronous messaging with RabbitMQ

## Status

Accepted (2026-07-28). Implemented in Sprint 6: `libs/messaging` wraps
amqplib 2.0.1 + amqp-connection-manager 5.0.0; auth-service publishes
`user.registered.v1`, tickets-service publishes the `ticket.*.v1` lifecycle
family, and users-service consumes registrations into a profile projection.

## Context

Sprints 2–5 built the synchronous path (web → bff → gateway → services).
The roadmap now needs services to react to each other's facts — profiles
projected from registrations today; audit, notification and analytics
consumers next — without adding synchronous coupling or cross-service
database access (forbidden by ADR 0003). The compose stack has carried an
unused RabbitMQ 4.3 broker since Sprint 1 precisely for this moment.

Constraints:

- Contracts must be explicit and versioned: independent deployability means
  a producer can never assume every consumer upgraded.
- Consumers must tolerate redelivery (broker semantics are at-least-once).
- Failures must be observable, not silent: rejected messages need a place
  to be inspected and replayed.
- Library versions verified against official documentation/registry at
  implementation time: amqplib 2.0.1 (public API unchanged from 0.10.x;
  bundled TypeScript types; Node ≥ 18), amqp-connection-manager 5.0.0
  (Node ≥ 20, peer `amqplib: *`). Workspace runs Node 24.

## Options considered

### 1. amqplib + amqp-connection-manager behind our own thin library (chosen)

- For: full control of topology (topic exchange, versioned routing keys,
  per-queue DLQs); zod contract validation on both produce and consume;
  automatic reconnection with topology re-setup and confirm-buffered
  publishes; the library stays framework-agnostic and services wire it
  through the same port/adapter factories as every other dependency.
- Against: we own more code (connection handling, dispatch, dead-lettering)
  and its tests.

### 2. @nestjs/microservices RMQ transport

- For: first-party NestJS, decorator-driven handlers.
- Against: designed around request/response patterns and a single queue per
  app; topic-exchange fan-out, per-event routing keys and custom DLQ
  topology fight the abstraction. Its envelope (`pattern`/`data`) is not a
  contract we control.

### 3. @golevelup/nestjs-rabbitmq

- For: mature community package, declarative exchange/queue decorators.
- Against: a large third-party framework where we need a small, explicit
  surface; couples messaging to Nest, while our application layers stay
  framework-free.

## Decision

Option 1. One durable topic exchange `helpdesk.events` carries every domain
event; the routing key is exactly the event type. Contracts are zod schemas
whose version lives in the name (`user.registered.v1`): changing a payload
shape means adding a v2 contract and publishing both until consumers
migrate — v1 is never mutated. Consumers own durable queues
(`<service>.<purpose>`) that dead-letter rejected messages into
`<queue>.dlq` via the shared direct exchange `helpdesk.events.dlx`, with no
automatic retry: at-least-once delivery plus idempotent handlers cover
transient issues, and poisoned messages wait in the DLQ for inspection and
manual replay.

## Consequences and accepted trade-offs

- **No outbox yet.** Producers publish after their database transaction
  commits, best-effort: a broker outage means the write succeeds and the
  event is lost (logged, never failing the request). Acceptable while every
  projection can be rebuilt; a transactional outbox becomes necessary when
  an event consumer is business-critical (candidate: audit-service, S7).
- **Handlers must be idempotent** — delivery is at-least-once by design.
  users-service projects with an upsert keyed by userId.
- **No retry/backoff tiers.** First failure dead-letters the message. If
  DLQs accumulate transient-failure messages, a delayed-retry topology is
  the follow-up.
- **Contract vocabularies are duplicated on purpose** (e.g. ticket statuses
  in `libs/messaging` vs the tickets domain): the contract is the public
  agreement and must not import a service's internals; drift is caught by
  producer-side validation in tests.

## Amendment — Sprint 9.3: how the envelope evolves

This ADR settled how a **contract** evolves and said nothing about how the
**envelope** does. That gap surfaced when the tenancy migration needed every
event to carry an organization, and it is worth closing here rather than
leaving the next person to infer a rule from one commit.

The distinction that matters: a payload belongs to one contract, an envelope
belongs to every event. So they cannot evolve the same way.

**Envelope fields are added optional, and never renamed or removed.** One
`eventEnvelopeSchema` validates every message on the wire, including the v1
messages a compatibility window keeps alive, so a required new field would
reject the entire existing stream at every consumer at once — the opposite of
what versioning is for. Two fields have been added this way: `correlationId`
in Sprint 9.2 and `organizationId` in 9.3.

**A field is envelope-shaped when it describes the delivery rather than the
subject.** Both of these do: which request caused the event, and which tenant
it belongs to. Neither is part of any one contract's meaning, and both are
needed by consumers that hold no contract at all — the audit trail decodes
every event with envelope-only validation, so anything it must read has to be
somewhere it can find without knowing what the event is. Every contract names
its subject differently (`ticketId`, `userId`, `suggestionId`); the envelope
is the only place that is the same for all of them.

**Requiredness lives on the path, not on the schema.** A v2 contract must
always be published with an organization, but the schema cannot say so while
it also has to accept v1. The check therefore sits at each publishing adapter,
which is also the only place that still knows _why_ a tenant is missing and
can log it. `buildEnvelope` validates the payload and never the envelope, so
nothing in the library will catch a producer that forgets — that is a real
sharp edge and the reason the check is written out at every call site instead
of being assumed.

None of this weakens the rule above. Changing a payload shape still means a
new contract and a compatibility window; `ticket.created.v2` exists precisely
because the alternative — mutating the stream every consumer already reads —
is what this ADR forbids.
