# System Context

Status: Sprint 1 snapshot, kept as the original target picture. It is now
out of date in the direction of progress: authentication, tickets, the
event-driven services and (since Sprint 8) `ai-service` all exist. The
**README status table** is the current answer; the sprint notes at the end
record what changed about the AI boxes and, in Sprint 9.2, about where
tenancy sits.

## Actors

| Actor              | Role                                                                                                                             | Status                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| End user           | Submits and follows up on support requests                                                                                       | Future — no user-facing features exist                  |
| Support technician | Works the ticket queue, assisted by AI (summaries, classification, priority suggestions, suggested replies, duplicate detection) | Future — all AI assistance is planned, none implemented |
| Administrator      | Manages users, teams, and platform configuration                                                                                 | Future                                                  |
| Developer          | Runs the applications and local infrastructure                                                                                   | The only actual user today                              |

## Context today (Implemented)

```
+-----------+       +------------------+       +--------------------+       +---------------------+
|  Browser  | ----> | web (Next.js 16) | ----> | web-bff (NestJS 11)| ----> | api-gateway (Nest 11)|
| developer |  :3000|  landing page    |  :3001|  BFF for web       |  :3002|  routes nothing yet  |
+-----------+       +------------------+       +--------------------+       +---------------------+
                                                                                      |
                                                                                      v
                                                                                 (no downstream
                                                                                  services exist)

Local infrastructure (compose.yaml) — running but UNUSED by application code:
  postgres:18-alpine    host 5433 -> container 5432
  redis:8-alpine        6379 (requirepass)
  rabbitmq:4.3          5672, management UI 15672
```

Notes on the current state:

- `web` serves a minimal landing page only.
- `web-bff` and `api-gateway` expose `GET /health` and `GET /health/ready`; readiness returns `checks: []` because no external dependency is probed yet.
- CORS: `web-bff` allows only `http://localhost:3000`. `api-gateway` intentionally has no CORS — browsers never call it; it is server-to-server only.
- Cross-service requests carry `x-request-id` / `x-trace-id` via correlation middleware. This is request correlation, not distributed tracing (no spans, no sampling, no W3C traceparent); real tracing is planned separately.
- PostgreSQL is published on host port 5433 because the development machine runs a native PostgreSQL 16 on 5432 that must not be touched.
- No application code connects to Postgres, Redis, or RabbitMQ yet; they stand by for future services.

## Target context (Planned)

```
+-----------+     +-----+     +---------+     +-------------+
|  Browser  | --> | web | --> | web-bff | --> | api-gateway |
+-----------+     +-----+     +---------+     +------+------+
                                                     |
              +----------------+----------------+----+-----------+----------------+
              |                |                |                |                |
              v                v                v                v                v
        auth-service    users-service   tickets-service    ai-service    notification-service
                                                                                 |
                        audit-service   analytics-service <----------------------+

Synchronous HTTP for request/response paths.
RabbitMQ carries versioned events (e.g. ticket.created.v1) for facts and decoupling.

Planned external systems:
  ai-service           --> AI provider (behind an abstraction; provider not selected)
  notification-service --> email delivery provider
```

Target notes (all Planned):

- Eleven applications total, and all eleven exist today (`web`, `web-bff`, `api-gateway`, `auth-service`, `users-service`, `tickets-service`, `ai-service`, `notification-service`, `audit-service`, `analytics-service`, `organizations-service`). The Sprint 1 note counted ten, of which three existed.
- One logical database per service in the single Postgres instance (`helpdesk_auth`, `helpdesk_users`, `helpdesk_tickets`, `helpdesk_audit`, `helpdesk_notifications`, `helpdesk_analytics`, `helpdesk_ai`, `helpdesk_organizations`), each with its own credentials and migrations. No cross-service foreign keys, ever.
- Event name candidates: `UserCreated`, `TicketCreated`, `TicketAssigned`, `AIAnalysisRequested`, `NotificationSent`.
- External systems (AI provider, email delivery) will sit behind service-owned abstractions so providers can be swapped without touching domain code.

### Sprint 8–9.0 update to the AI boxes

- `ai-service` exists (port 3009, `helpdesk_ai`) and the "behind an
  abstraction" intent above held: the abstraction is a one-method
  `AiProvider` port with schema-validated output (ADR 0010). The arrow to
  "AI provider" is real as of Sprint 9.0 — `AI_PROVIDER=gemini` calls
  Google's Interactions API over HTTPS. It is not the default: without
  provider credentials a deterministic local provider answers instead,
  and that is what CI runs on.
- `AIAnalysisRequested` was never introduced. Suggestions are requested
  synchronously by staff, and `ai-service` reads the ticket from
  `tickets-service` with the caller's token, because event contracts carry
  no ticket text (ADR 0011). The only AI event is
  `ai.suggestion.created.v1`, published after the fact, metadata only.

### Sprint 9.2 update: organizations-service sits outside the fan-out

- An eleventh application exists: `organizations-service` (port 3010,
  `helpdesk_organizations`), owner of organizations and memberships
  (ADR 0013). It is not one of the boxes under `api-gateway` above, and it
  is deliberately absent from the gateway's routing table — the browser path
  does not reach it at all.
- The one arrow into it comes from `auth-service`, directly, server to
  server, and only while an access token is being minted; the call carries a
  shared secret in `x-internal-service-token`. That is the only synchronous
  dependency the tenancy work added anywhere. Every other service reads the
  active organization as a claim in the token it already verifies
  (ADR 0014), so none of them gained an edge to `organizations-service` —
  which is the whole point of putting tenancy in the token.
- On the event side it is a consumer only: `user.registered.v1`, on its own
  queue. It publishes nothing.

## Boundaries

- The browser talks only to `web` and (via `web`'s frontend code) to `web-bff`. It never reaches `api-gateway` or any future backend service directly.
- `api-gateway` is the single entry point for external clients into the domain services. Internal, service-to-service calls go direct instead of becoming gateway hops (ADR 0011): `ai-service` → `tickets-service`, and `auth-service` → `organizations-service` at token-mint time. `organizations-service` has no gateway route at all.
- Local infrastructure (Postgres 5433, Redis 6379, RabbitMQ 5672/15672) is reachable only from the developer machine; credentials are non-default, local-only examples overridable via a git-ignored `.env`.
