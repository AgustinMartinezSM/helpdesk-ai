# System Context

Status: Sprint 1. Only the platform foundation exists. No authentication, no tickets, no domain features, no AI features. This document separates what runs today from the target the platform is being built toward.

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

- Ten applications total; three exist today (`web`, `web-bff`, `api-gateway`).
- One logical database per service in the single Postgres instance (`helpdesk_auth`, `helpdesk_users`, `helpdesk_tickets`, `helpdesk_audit`, `helpdesk_analytics`), each with its own credentials and migrations. No cross-service foreign keys, ever.
- Event name candidates: `UserCreated`, `TicketCreated`, `TicketAssigned`, `AIAnalysisRequested`, `NotificationSent`.
- External systems (AI provider, email delivery) will sit behind service-owned abstractions so providers can be swapped without touching domain code.

## Boundaries

- The browser talks only to `web` and (via `web`'s frontend code) to `web-bff`. It never reaches `api-gateway` or any future backend service directly.
- `api-gateway` is the single entry point for all future domain services.
- Local infrastructure (Postgres 5433, Redis 6379, RabbitMQ 5672/15672) is reachable only from the developer machine; credentials are non-default, local-only examples overridable via a git-ignored `.env`.
