# Service Boundaries

Status date: 2026-07-27 (end of Sprint 1), except the `ai-service` entry,
updated in Sprint 8, and the `organizations-service` entry, added in
Sprint 9.2. The status labels below are a Sprint 1 snapshot and most of the
"Planned" services now exist — the **README status table** is the current,
maintained answer; this document is kept for the boundary rules, which have
not changed.

This document lists every application in the target architecture, what each one is responsible for, and the rules that keep those responsibilities from leaking across boundaries. Status labels are strict: **Implemented** means the code exists in this repository today; **Planned** means it does not exist yet in any form.

## Target topology

```
web -> web-bff -> api-gateway -> { auth-service, users-service, tickets-service,
                                   ai-service, notification-service,
                                   audit-service, analytics-service }

auth-service -> organizations-service   (direct, at token-mint time only;
                                         deliberately not a gateway route)
```

Synchronous HTTP is used for request/response paths. Facts and decoupled workflows travel as versioned RabbitMQ events (e.g. `ticket.created.v1`). Candidate event names: `UserCreated`, `TicketCreated`, `TicketAssigned`, `AIAnalysisRequested`, `NotificationSent`.

As of Sprint 1, only `web`, `web-bff`, and `api-gateway` exist (3 of 10). The gateway routes nothing yet because no downstream service exists.

Two internal edges have been added since, both server to server and neither of them a gateway route: `ai-service` reads a ticket from `tickets-service` (Sprint 8, ADR 0011), and `auth-service` calls `organizations-service` while minting an access token (Sprint 9.2, ADR 0014). The second is the only synchronous dependency the tenancy work introduced anywhere in the platform. Every other service reads the active organization as a claim in the access token it already verifies, so none of them gained a dependency on `organizations-service` — which is the whole point of putting tenancy in the token.

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

Sprint 9.2 gave auth-service its first outbound call, and the platform its second internal synchronous edge: while minting an access token — on login and on refresh alike — it asks `organizations-service` for the caller's active membership and stamps `org`, `perms` and `mv` into the token (ADR 0014). Because minting is the one moment there is no caller token to forward, this is also the platform's first service credential (`INTERNAL_SERVICE_TOKEN`, deliberately not the JWT signing key and deliberately without a default). Three details are current state rather than target: `perms` is an empty array until the permission evaluator exists, the claims are omitted rather than nulled when no membership resolves, and resolution fails open — an unreachable `organizations-service` produces a token without the claims plus a logged warning, where ADR 0014 says login should fail. That deviation is deliberate and holds only while nothing reads the claims. `roles` stays as a compatibility claim. Refresh sessions were not touched: they stay keyed by user, because a session belongs to a person rather than to a workspace.

### organizations-service — Implemented (Sprint 9.2)

Owns organizations and memberships — which workspaces exist, and who belongs to one under which role template (`helpdesk_organizations`, port 3010, ADR 0013). Sole writer of that database. `organization_id` is a real foreign key inside it; `user_id` is an opaque uuid with no foreign key, because that row belongs to auth-service (ADR 0003). It consumes `user.registered.v1` on its own queue to create the membership for a new user, and publishes nothing — membership lifecycle events are a later phase.

Its data is the exception to the projection rule the other consumers follow: losing a membership locks a person out of an organization, and nothing replays it. Users who registered before the service existed are reached by an operator script instead (`infrastructure/postgres/operations/backfill-bootstrap-memberships.sh`), which reads `helpdesk_auth` and writes `helpdesk_organizations` — a thing an operator procedure may do and a service may not, since auth-service exposes no user listing and ADR 0003 forbids reading its database. `data-ownership.md` covers the consequences.

Two things about it are deliberate and unlike every other service:

- **It is absent from the api-gateway routing table.** Browsers have no path to it at all. Its single internal endpoint, `GET /internal/memberships/:userId/active`, is called only by auth-service, server to server, authenticated by a shared secret in the `x-internal-service-token` header — following ADR 0011's rule that internal calls do not become gateway hops.
- **It declares no `JWT_ACCESS_SECRET`.** It has no person-facing endpoint and verifies no access tokens, so carrying the key that signs people's sessions would be configuration it never reads.

### users-service — Planned

Owns user and agent profiles, teams, and org structure (`helpdesk_users` database). Publishes user lifecycle events (e.g. `UserCreated`) that other services consume; it does not know about tickets.

### tickets-service — Planned

Owns the core support-request domain: tickets, statuses, assignments, comments, SLA state (`helpdesk_tickets` database). Publishes ticket lifecycle events (`TicketCreated`, `TicketAssigned`, ...). It requests AI enrichment via events rather than embedding AI logic.

### ai-service — Implemented (Sprint 8); Google Gemini connected (Sprint 9.0)

Owns all model-backed assistance. Implemented: summarization, classification, priority suggestion and reply drafts, staff-only, generated on request and stored append-only in `helpdesk_ai` (port 3009). Duplicate detection is still planned — it needs embeddings and similarity search.

Two boundary decisions differ from the Sprint 1 sketch above, both deliberate:

- **It reads a ticket synchronously**, from `tickets-service`, forwarding the caller's own access token — the event contracts carry no ticket text, and a service credential with standing read access to every ticket was the wrong price to pay for asynchrony (ADR 0011). It stores no ticket text, only its own output plus a hash of the context.
- **The model provider sits behind a one-method port** (`AiProvider`), with output validated against per-task zod schemas before anything is stored (ADR 0010). Two adapters ship: `local`, a deterministic keyword-and-template provider that is the default and the one CI runs on, and `gemini`, which calls Google's Interactions API. The port's promise that adding a provider is "an adapter plus a config value" was borne out — the Gemini adapter changed nothing in the domain, the application layer, the controller, the BFF or the UI, and added no dependency.

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
- **One service, one database.** Each domain service exclusively owns its logical database in the shared PostgreSQL instance (`helpdesk_auth`, `helpdesk_users`, `helpdesk_tickets`, `helpdesk_audit`, `helpdesk_notifications`, `helpdesk_analytics`, `helpdesk_ai`, `helpdesk_organizations`, each with separate credentials and migrations). No cross-service foreign keys, ever. Cross-service data flows through APIs or events.
- **Facts travel as versioned events.** Anything another service merely needs to know about (not decide on) is published, not fetched.

## Incremental introduction

Services are generated only when a sprint actually needs them. Sprint 1 delivered the three edge applications because they are prerequisites for everything else; `auth-service` was scaffolded at the start of Sprint 2 as the first domain-service boundary. The remaining services will be scaffolded in the sprints that implement their features. Nothing is pre-generated as an empty shell.

`organizations-service` was not in the Sprint 1 list of ten at all. It was added in Sprint 9.2, when the tenancy model needed a service to own organizations and memberships (ADR 0013), which makes eleven applications rather than ten.

## Shared library policy

Implemented:

- `libs/configuration` (`@helpdesk-ai/configuration`) — zod-based environment schemas and fail-fast `validateEnv`. Framework-agnostic (no NestJS dependency).
- `libs/messaging` (`@helpdesk-ai/messaging`) — RabbitMQ publishing/consuming conventions: zod event contracts versioned in the event name, topology declaration and the shared client (Sprint 6, ADR 0005).
- `libs/observability` (`@helpdesk-ai/observability`) — nestjs-pino structured logging and request-correlation middleware (`x-request-id` / `x-trace-id`). This is request correlation, not distributed tracing; tracing is planned separately.
- `libs/security` (`@helpdesk-ai/security`) — the shared JWT access guard and the `Actor` interface derived from the verified token claims. Extracted in Sprint 6, when `users-service` was about to become the third copy of the same guard. `tickets-service` and `users-service` still carry their own earlier `Actor` copies; deleting those is pending.

Candidates for later, created only when a concrete consumer exists:

- `libs/contracts` — API/event schema definitions shared between producers and consumers.
- `libs/testing` — shared test utilities.

Hard rules:

- **No shared domain entities.** A `Ticket` class used by two services couples their release cycles and violates database ownership. Services share contracts (schemas), never models.
- **No generic `shared`/`common`/`utils` library.** Every library has a single stated purpose; a dumping ground accumulates hidden coupling.
