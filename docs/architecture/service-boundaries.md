# Service Boundaries

Status date: 2026-07-27 (end of Sprint 1), except the `ai-service` entry,
updated in Sprint 8. The status labels below are a Sprint 1 snapshot and
most of the "Planned" services now exist — the **README status table** is
the current, maintained answer; this document is kept for the boundary
rules, which have not changed.

This document lists every application in the target architecture, what each one is responsible for, and the rules that keep those responsibilities from leaking across boundaries. Status labels are strict: **Implemented** means the code exists in this repository today; **Planned** means it does not exist yet in any form.

## Target topology

```
web -> web-bff -> api-gateway -> { auth-service, users-service, tickets-service,
                                   ai-service, notification-service,
                                   audit-service, analytics-service }
```

Synchronous HTTP is used for request/response paths. Facts and decoupled workflows travel as versioned RabbitMQ events (e.g. `ticket.created.v1`). Candidate event names: `UserCreated`, `TicketCreated`, `TicketAssigned`, `AIAnalysisRequested`, `NotificationSent`.

As of Sprint 1, only `web`, `web-bff`, and `api-gateway` exist (3 of 10). The gateway routes nothing yet because no downstream service exists.

## Service catalog

### web — Implemented (minimal)

Next.js 16 frontend (App Router, React 19). Renders the UI and nothing else: no domain logic, no direct calls to internal services — it talks only to `web-bff`. Current scope is a minimal landing page with one passing test. Dev port 3000.

### web-bff — Implemented (foundation only)

NestJS 11 backend-for-frontend. Composes and shapes data for the web frontend: aggregating calls, adapting payloads to what screens need, and holding frontend-session concerns. It owns no domain data and no domain rules; anything a second client would also need belongs behind the gateway, not here. Current scope: typed env validation bootstrap, structured logging with request correlation, health endpoints (`/health`, `/health/ready`), helmet, CORS restricted to `http://localhost:3000`. Port 3001.

### api-gateway — Implemented (foundation only)

NestJS 11 single entry point to the internal service mesh. Its job is routing, cross-cutting security (authn enforcement, rate limiting — both planned), and request fan-out policy. It owns no domain rules and stores no domain data. CORS is intentionally not enabled: browsers never call it; it is server-to-server only (`web-bff` is its client). Current scope matches web-bff: bootstrap, logging/correlation, health endpoints. It routes to nothing because no downstream service exists yet. Port 3002.

### auth-service — Implemented

Owns authentication and authorization: credentials, sessions/tokens, roles and permissions. Sole writer of the `helpdesk_auth` database. No other service validates credentials or mints tokens.

Current scope (Sprint 2): registration, login, rotating refresh sessions with reuse detection, logout and `GET /auth/me`, backed by Prisma 7 over `helpdesk_auth` (ADR 0004) with argon2id password hashing and JWT access tokens. Clean-architecture layering: domain and application layers are framework-free; Prisma, argon2 and JWT live in infrastructure adapters. Readiness probes the database for real. Planned next: permission claims beyond the basic roles array, and consumption by the gateway/BFF path.

### users-service — Planned

Owns user and agent profiles, teams, and org structure (`helpdesk_users` database). Publishes user lifecycle events (e.g. `UserCreated`) that other services consume; it does not know about tickets.

### tickets-service — Planned

Owns the core support-request domain: tickets, statuses, assignments, comments, SLA state (`helpdesk_tickets` database). Publishes ticket lifecycle events (`TicketCreated`, `TicketAssigned`, ...). It requests AI enrichment via events rather than embedding AI logic.

### ai-service — Implemented (Sprint 8), model provider pending

Owns all model-backed assistance. Implemented: summarization, classification, priority suggestion and reply drafts, staff-only, generated on request and stored append-only in `helpdesk_ai` (port 3009). Duplicate detection is still planned — it needs embeddings and similarity search.

Two boundary decisions differ from the Sprint 1 sketch above, both deliberate:

- **It reads a ticket synchronously**, from `tickets-service`, forwarding the caller's own access token — the event contracts carry no ticket text, and a service credential with standing read access to every ticket was the wrong price to pay for asynchrony (ADR 0011). It stores no ticket text, only its own output plus a hash of the context.
- **The model provider sits behind a one-method port** (`AiProvider`), with output validated against per-task zod schemas before anything is stored (ADR 0010). A deterministic local provider ships today; connecting a paid provider is an adapter plus a config value, and it is an open product-owner decision.

It never writes to another service's database, and it has no path that changes a ticket: every suggestion is advice a person acts on or ignores.

### notification-service — Planned

Owns outbound notifications (email, in-app, future channels): templates, delivery, retries. Purely event-driven — reacts to facts published by other services and emits `NotificationSent`. Holds no domain state beyond delivery bookkeeping.

### audit-service — Planned

Owns the append-only audit trail (`helpdesk_audit` database). Consumes domain events and records who did what and when. Read-mostly for compliance queries; never a dependency on any request/response path.

### analytics-service — Planned

Owns reporting and metrics aggregates (`helpdesk_analytics` database). Consumes events into its own projections; queries never reach into other services' databases.

## Responsibility rules

- **web renders UI.** No business rules, no direct access to internal services or infrastructure.
- **web-bff composes for the frontend.** It may aggregate and reshape, but it owns no domain data. If logic would be duplicated by a second client (mobile, CLI), it is domain logic and belongs in a service behind the gateway.
- **api-gateway routes and secures.** No domain rules, no domain storage. Cross-cutting only.
- **One service, one database.** Each domain service exclusively owns its logical database in the shared PostgreSQL instance (plan: `helpdesk_auth`, `helpdesk_users`, `helpdesk_tickets`, `helpdesk_audit`, `helpdesk_analytics`, each with separate credentials and migrations). No cross-service foreign keys, ever. Cross-service data flows through APIs or events.
- **Facts travel as versioned events.** Anything another service merely needs to know about (not decide on) is published, not fetched.

## Incremental introduction

Services are generated only when a sprint actually needs them. Sprint 1 delivered the three edge applications because they are prerequisites for everything else; `auth-service` was scaffolded at the start of Sprint 2 as the first domain-service boundary. The remaining services will be scaffolded in the sprints that implement their features. Nothing is pre-generated as an empty shell.

## Shared library policy

Implemented:

- `libs/configuration` (`@helpdesk-ai/configuration`) — zod-based environment schemas and fail-fast `validateEnv`. Framework-agnostic (no NestJS dependency).
- `libs/observability` (`@helpdesk-ai/observability`) — nestjs-pino structured logging and request-correlation middleware (`x-request-id` / `x-trace-id`). This is request correlation, not distributed tracing; tracing is planned separately.

Candidates for later, created only when a concrete consumer exists:

- `libs/contracts` — API/event schema definitions shared between producers and consumers.
- `libs/messaging` — RabbitMQ publishing/consuming conventions.
- `libs/testing` — shared test utilities.

Hard rules:

- **No shared domain entities.** A `Ticket` class used by two services couples their release cycles and violates database ownership. Services share contracts (schemas), never models.
- **No generic `shared`/`common`/`utils` library.** Every library has a single stated purpose; a dumping ground accumulates hidden coupling.
