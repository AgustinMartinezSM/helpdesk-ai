# Data Ownership

Status: model adopted in Sprint 1; `helpdesk_auth` implemented in Sprint 2, `helpdesk_tickets` in Sprint 4, `helpdesk_users` in Sprint 6, `helpdesk_audit`, `helpdesk_notifications` and `helpdesk_analytics` in Sprint 7, `helpdesk_ai` in Sprint 8. `helpdesk_notifications` was added to the original plan when notification-service needed to own in-app notifications and its ticket-refs projection.

## Model

Each service exclusively owns its data store. The rules are absolute:

- A service reads and writes only its own database. No service ever queries another service's database, not even read-only.
- No cross-service foreign keys. Referential links across service boundaries are plain identifiers, validated by the owning service.
- Schema and migrations belong to the owning service alone. Nothing outside that service may depend on its table layout.

A service that needs another service's data has exactly three options:

1. **Sync API call** — request/response over HTTP to the owning service, routed through the api-gateway. Use for data that must be current at read time.
2. **Versioned async event** — consume events the owner publishes on RabbitMQ (e.g. `ticket.created.v1`). Event contracts are versioned; breaking changes mean a new version, not a mutated payload.
3. **Local projection** — a read model built by consuming those events, stored in the _consumer's_ database and owned by the consumer. The projection is eventually consistent and disposable: it can always be rebuilt from events or the owner's API.

```
tickets-service ──publishes──> RabbitMQ (ticket.created.v1)
                                   │
analytics-service <──consumes──────┘
       │
       └─ writes its own projection into helpdesk_analytics
          (never reads helpdesk_tickets directly)
```

## Local development layout

Local infrastructure runs one `postgres:18-alpine` container (see `compose.yaml`), published on host port **5433** because the development machine runs an untouchable native PostgreSQL 16 on 5432.

Inside that single instance, one logical database per service:

| Database                 | Owning service       | Status                                                      |
| ------------------------ | -------------------- | ----------------------------------------------------------- |
| `helpdesk_auth`          | auth-service         | Implemented (plus `helpdesk_auth_test` for integration)     |
| `helpdesk_users`         | users-service        | Implemented (plus `helpdesk_users_test`) — Sprint 6         |
| `helpdesk_tickets`       | tickets-service      | Implemented (plus `helpdesk_tickets_test`) — Sprint 4       |
| `helpdesk_audit`         | audit-service        | Implemented (plus `helpdesk_audit_test`) — Sprint 7         |
| `helpdesk_notifications` | notification-service | Implemented (plus `helpdesk_notifications_test`) — Sprint 7 |
| `helpdesk_analytics`     | analytics-service    | Implemented (plus `helpdesk_analytics_test`) — Sprint 7     |
| `helpdesk_ai`            | ai-service           | Implemented (plus `helpdesk_ai_test`) — Sprint 8            |

Each logical database gets its own credentials and its own migration history, so the isolation rules above are enforceable even though everything shares one container. `infrastructure/postgres/init` provisions roles and databases on first initialization of an empty volume; today it creates the `auth_service` role (owner of `helpdesk_auth` and `helpdesk_auth_test`). Migrations for `helpdesk_auth` live in `apps/auth-service/prisma/migrations` and run only under the `auth_service` role (Prisma, per ADR 0004). The `CREATEDB` grant on service roles is local-only — `prisma migrate dev` needs it for its shadow database; production roles must not have it.

### Why logical databases instead of one container per service

The development machine is RAM-constrained; running five-plus PostgreSQL containers locally buys nothing over five logical databases with separate credentials, and costs memory we do not have. Ownership is a discipline enforced by credentials and code review, not by process boundaries.

In production the same model maps to **separate database instances** (or managed clusters) per service. Because no code path ever crosses a database boundary, moving a logical database to its own instance is a connection-string change, not a refactor.

## Projections and their rebuild paths

Every local projection must name how it gets rebuilt if lost — RabbitMQ is
not a log (consumed events are gone; best-effort publishing means some
never existed), so "rebuild from events" is never the answer:

| Projection                            | Owner                | Rebuild path                                                                                                                                                 |
| ------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `user_profiles`                       | users-service        | GAP: auth-service exposes no user listing yet; an admin listing endpoint is the documented prerequisite                                                      |
| `ticket_refs`                         | notification-service | tickets-service `GET /tickets` with a staff token (id + requesterId suffice)                                                                                 |
| `ticket_snapshots` / `user_snapshots` | analytics-service    | tickets-service `GET /tickets` (status/priority/createdAt); user count needs the same auth listing as above                                                  |
| `notifications`                       | notification-service | NON-REBUILDABLE BY DESIGN: derived state plus per-user readAt; accepted as ephemeral UX, not records                                                         |
| `audit_events`                        | audit-service        | Not a projection — the trail itself. Append-only; NOT readable by other services for THEIR rebuilds (ADR 0006)                                               |
| `suggestions`                         | ai-service           | Not a projection — records of what a model answered. Append-only, NOT rebuildable: regenerating asks a provider again and gets a different answer (ADR 0010) |

`ai-service` deserves a note here because it is the one service that reads
another service's data synchronously (ADR 0011): it fetches a ticket from
`tickets-service` over HTTP, forwarding the caller's own access token, and
stores **no ticket text** — only its own output plus a SHA-256 hash of the
context that produced it. So `helpdesk_ai` holds no copy of anyone else's
data of record, and the ownership rule above still holds without exception.

Retention note: `helpdesk_audit` keeps event payloads (including
registration emails) indefinitely and the application exposes no deletion.
Any legal erasure request is an administrative database procedure outside
the application, executed by the platform operator.

## What this rules out

- Shared "common" tables or a shared ORM schema package.
- Cross-database joins, foreign data wrappers, or replication between service databases.
- One service running migrations against another service's database.
