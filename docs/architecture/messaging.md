# Messaging

Status: implemented in Sprint 6 (ADR 0005). Broker: RabbitMQ 4.3 from
`compose.yaml` (management UI on http://localhost:15672).

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
- Each consuming service owns its durable queue and its `.dlq`. Queues from
  Sprint 6: `users-service.user-registered`.
- Delivery is at-least-once and there is no automatic retry: handlers must
  be idempotent, and rejected messages dead-letter immediately.

## Contracts (`@helpdesk-ai/messaging`)

Contracts are zod schemas versioned in the event name; the envelope is
`{ id (uuid), type, occurredAt (ISO), correlationId?, payload }`. Producers
validate before publishing (a malformed event is a bug in the producer);
consumers validate envelope and payload before the handler runs.

| Event                      | Producer        | Consumers (S6)             |
| -------------------------- | --------------- | -------------------------- |
| `user.registered.v1`       | auth-service    | users-service (projection) |
| `ticket.created.v1`        | tickets-service | — (audit/analytics in S7)  |
| `ticket.status-changed.v1` | tickets-service | — (audit/notification, S7) |
| `ticket.assigned.v1`       | tickets-service | — (audit/notification, S7) |
| `ticket.comment-added.v1`  | tickets-service | — (audit/notification, S7) |

Changing a payload shape = new `v2` contract published alongside `v1` until
every consumer migrates. `v1` is never mutated.

## Client behavior

`MessagingClient` (amqplib + amqp-connection-manager) reconnects
automatically, re-runs topology setup and re-subscribes consumers after a
broker restart, and resolves `publish()` only on broker confirm (publishes
made while disconnected are buffered). Publishing adapters in services are
best-effort by contract: the primary write already committed, so broker
failures are logged, never breaking the request (no outbox yet — ADR 0005
records when that trade-off must be revisited).

users-service starts its subscription fire-and-forget on bootstrap: a
broker outage delays consumption instead of blocking HTTP reads, and the
profile projection catches up when the broker returns (`GET /users/me`
answers 404 until then — eventual consistency is part of the API contract).

## Local inspection

- Management UI: http://localhost:15672 (credentials in `.env.example`).
- DLQs are plain queues: `users-service.user-registered.dlq` holds every
  message that failed decoding or handling, untouched, for manual replay.
