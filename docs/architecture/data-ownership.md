# Data Ownership

Status: model adopted in Sprint 1; per-service databases are **Planned** (no service schemas exist yet).

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

## Local development layout (Planned)

Local infrastructure runs one `postgres:18-alpine` container (see `compose.yaml`), published on host port **5433** because the development machine runs an untouchable native PostgreSQL 16 on 5432.

Inside that single instance, the plan is one logical database per future service:

| Database             | Owning service (Planned) |
| -------------------- | ------------------------ |
| `helpdesk_auth`      | auth-service             |
| `helpdesk_users`     | users-service            |
| `helpdesk_tickets`   | tickets-service          |
| `helpdesk_audit`     | audit-service            |
| `helpdesk_analytics` | analytics-service        |

Each logical database gets its own credentials and its own migration history, so the isolation rules above are enforceable even though everything shares one container. **None of these databases exist yet** — today the container holds only the base `helpdesk_platform` admin database created at first boot.

### Why logical databases instead of one container per service

The development machine is RAM-constrained; running five-plus PostgreSQL containers locally buys nothing over five logical databases with separate credentials, and costs memory we do not have. Ownership is a discipline enforced by credentials and code review, not by process boundaries.

In production the same model maps to **separate database instances** (or managed clusters) per service. Because no code path ever crosses a database boundary, moving a logical database to its own instance is a connection-string change, not a refactor.

## What this rules out

- Shared "common" tables or a shared ORM schema package.
- Cross-database joins, foreign data wrappers, or replication between service databases.
- One service running migrations against another service's database.
