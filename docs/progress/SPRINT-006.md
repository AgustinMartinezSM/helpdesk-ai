# Sprint 6 — Events on the Wire

Status: complete. Branch: `feature/HD-001-initialize-workspace`. Date: 2026-07-28.

## Goal

Make services react to each other's facts without synchronous coupling:
real RabbitMQ messaging with versioned contracts, and a users-service that
projects registrations into queryable profiles.

## Scope completed

- **libs/messaging** (ADR 0005): zod contracts versioned in the event name
  (`user.registered.v1`, `ticket.created.v1`, `ticket.status-changed.v1`,
  `ticket.assigned.v1`, `ticket.comment-added.v1`), standard envelope, one
  durable topic exchange + per-queue DLQs, `MessagingClient` over
  amqplib 2.0.1 + amqp-connection-manager 5.0.0 (auto-reconnect, topology
  re-setup, publishes resolve on broker confirm). Framework-agnostic on
  purpose. Versions verified against the npm registry and upstream
  changelogs (amqplib 0.10→2.0 kept its public API; ACM 5 only raised the
  Node floor).
- **libs/security**: users-service was the third consumer of the duplicated
  `JwtAccessGuard`, the documented extraction threshold. auth and tickets
  migrated; the lib's dist compiles with decorator metadata (see Findings).
- **auth-service**: `RegisterUserUseCase` publishes `user.registered.v1`
  through an `EVENT_PUBLISHER` port after the row commits; best-effort
  RabbitMQ adapter owns its connection (no outbox yet — trade-off in ADR
  0005). Suites override the port and stay broker-free.
- **tickets-service**: the four mutating use cases emit the `ticket.*.v1`
  family after persisting, mirroring the transactional history entries.
- **users-service (:3005)**: owns `helpdesk_users` (Prisma 7, same layout
  as tickets). Consumes `user.registered.v1` from its durable queue with an
  idempotent upsert; redelivery keeps `createdAt` and display-name edits.
  HTTP: `GET /users/me` (404 until projected — eventual consistency is part
  of the contract) and staff-only `GET /users` for the assignee picker
  deferred in Sprint 5. The consumer starts fire-and-forget so a broker
  outage never blocks HTTP reads.
- **api-gateway**: `/api/users/*` routes to users-service; `.env.example`
  gained the `TICKETS_SERVICE_URL` entry missing since Sprint 5.
- **Infrastructure/CI**: users role + databases in the init script and
  provisioned on the live container; tickets/users passwords now actually
  reach the postgres container; CI adds a rabbitmq service container and
  the messaging + users integration targets.

## Validation results

| Check                                       | Result                                                                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workspace gate (10 projects)                | format/lint/test/build/typecheck all passing                                                                                                                                                                          |
| Fast tests                                  | 111 total (+36: messaging 15, security 4, users 10, new event-publication coverage in auth/tickets)                                                                                                                   |
| Integration tests                           | 13 total (+3: messaging publish/consume round-trip and dead-lettering against real RabbitMQ; users full-chain publish → broker → consumer → Postgres row with idempotent redelivery)                                  |
| Full-chain runtime E2E (production bundles) | register via gateway → `user.registered.v1` → profile served by `GET /api/users/me` on the first poll; staff directory 403 for plain users; ticket create + comment observed on the broker as `ticket.*.v1` envelopes |
| CI on GitHub                                | **NOT VERIFIED** — still no remote                                                                                                                                                                                    |

## Findings

- Consumers load workspace libs from their compiled `dist` (`test` depends
  on `^build`), and `tsc` was emitting the security lib without decorator
  metadata: Nest silently injected `undefined` into the guard's
  `JwtService` and every request bounced as 401. Libs whose classes use
  constructor injection must enable `experimentalDecorators` +
  `emitDecoratorMetadata` in their `tsconfig.lib.json`; the existing libs
  never tripped this because none had injectable classes.
- `nx sync` + `nx reset` were both needed before Nx inferred targets for
  the new libs (stale-graph gotcha, third occurrence).

## Intentionally deferred

Outbox pattern (revisit with audit-service, S7), retry/backoff tiers on top
of the DLQs, assignee picker UI in web (backend directory now exists),
signup UI, push to remote + first real CI run.
