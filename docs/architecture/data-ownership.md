# Data Ownership

Status: model adopted in Sprint 1; `helpdesk_auth` implemented in Sprint 2, `helpdesk_tickets` in Sprint 4, `helpdesk_users` in Sprint 6, `helpdesk_audit`, `helpdesk_notifications` and `helpdesk_analytics` in Sprint 7, `helpdesk_ai` in Sprint 8, `helpdesk_organizations` in Sprint 9.2. `helpdesk_notifications` was added to the original plan when notification-service needed to own in-app notifications and its ticket-refs projection.

## Model

Each service exclusively owns its data store. The rules are absolute:

- A service reads and writes only its own database. No service ever queries another service's database, not even read-only.
- No cross-service foreign keys. Referential links across service boundaries are plain identifiers, validated by the owning service.
- Schema and migrations belong to the owning service alone. Nothing outside that service may depend on its table layout.

A service that needs another service's data has exactly three options:

1. **Sync API call** — request/response over HTTP to the owning service, direct rather than through the api-gateway. Use for data that must be current at read time. The gateway is the entry point for external clients; making it a hop in internal paths too would put it in the middle of every service-to-service call (ADR 0011).
2. **Versioned async event** — consume events the owner publishes on RabbitMQ (e.g. `ticket.created.v1`). Event contracts are versioned; breaking changes mean a new version, not a mutated payload.
3. **Local projection** — a read model built by consuming those events, stored in the _consumer's_ database and owned by the consumer. A projection is eventually consistent and disposable, but disposable is not the same as automatically recoverable: consumed events are gone, so each projection has to name its own rebuild path. Not every store below is a projection — see "Projections and their rebuild paths".

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

| Database                 | Owning service        | Status                                                        |
| ------------------------ | --------------------- | ------------------------------------------------------------- |
| `helpdesk_auth`          | auth-service          | Implemented (plus `helpdesk_auth_test` for integration)       |
| `helpdesk_users`         | users-service         | Implemented (plus `helpdesk_users_test`) — Sprint 6           |
| `helpdesk_tickets`       | tickets-service       | Implemented (plus `helpdesk_tickets_test`) — Sprint 4         |
| `helpdesk_audit`         | audit-service         | Implemented (plus `helpdesk_audit_test`) — Sprint 7           |
| `helpdesk_notifications` | notification-service  | Implemented (plus `helpdesk_notifications_test`) — Sprint 7   |
| `helpdesk_analytics`     | analytics-service     | Implemented (plus `helpdesk_analytics_test`) — Sprint 7       |
| `helpdesk_ai`            | ai-service            | Implemented (plus `helpdesk_ai_test`) — Sprint 8              |
| `helpdesk_organizations` | organizations-service | Implemented (plus `helpdesk_organizations_test`) — Sprint 9.2 |

Each logical database gets its own credentials and its own migration history, so the isolation rules above are enforceable even though everything shares one container. `infrastructure/postgres/init` provisions roles and databases on first initialization of an empty volume; today it creates eight role/database triples, one per service — `auth_service` owning `helpdesk_auth` and `helpdesk_auth_test`, and the same shape for `tickets_service`, `users_service`, `audit_service`, `notification_service`, `analytics_service`, `ai_service` and `organizations_service`. Migrations for `helpdesk_auth` live in `apps/auth-service/prisma/migrations` and run only under the `auth_service` role (Prisma, per ADR 0004). The `CREATEDB` grant on service roles is local-only — `prisma migrate dev` needs it for its shadow database; production roles must not have it.

### Why logical databases instead of one container per service

The development machine is RAM-constrained; running eight PostgreSQL containers locally buys nothing over eight logical databases with separate credentials, and costs memory we do not have. Ownership is a discipline enforced by credentials and code review, not by process boundaries.

In production the same model maps to **separate database instances** (or managed clusters) per service. Because no code path ever crosses a database boundary, moving a logical database to its own instance is a connection-string change, not a refactor.

## Projections and their rebuild paths

Every local projection must name how it gets rebuilt if lost — RabbitMQ is
not a log (consumed events are gone; best-effort publishing means some
never existed), so "rebuild from events" is never the answer:

| Projection                            | Owner                 | Rebuild path                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user_profiles`                       | users-service         | HYBRID since Sprint 9.6 (ADR 0018): the identity seed (user_id, email) is projected and re-seedable — still behind the same GAP (auth-service exposes no user listing) — but the profile columns and the `organization_profile_fields`/`profile_field_values` tables are SOURCE OF TRUTH. Losing them is losing data; this database stopped being disposable      |
| `ticket_refs`                         | notification-service  | Per organization, by construction: tickets-service `GET /tickets` is tenant-scoped, so a rebuild runs once per organization with that organization's staff token, and the rebuilt rows take their tenant from the caller's scope (R13). A cross-tenant "rebuild everything" read no longer exists                                                                 |
| `ticket_snapshots` / `user_snapshots` | analytics-service     | Ticket snapshots: per organization via the scoped `GET /tickets`, same shape as ticket_refs. User snapshots: GAP twice over — registrations need the auth listing above, and the organization stamp would need a reconciliation script against `helpdesk_organizations` (the `backfill-directory-memberships.sh` pattern), which is not built                     |
| `notifications`                       | notification-service  | NON-REBUILDABLE BY DESIGN: derived state plus per-user readAt; accepted as ephemeral UX, not records                                                                                                                                                                                                                                                              |
| `audit_events`                        | audit-service         | Not a projection — the trail itself. Append-only; NOT readable by other services for THEIR rebuilds (ADR 0006)                                                                                                                                                                                                                                                    |
| `suggestions`                         | ai-service            | Not a projection — records of what a model answered. Append-only, NOT rebuildable: regenerating asks a provider again and gets a different answer (ADR 0010)                                                                                                                                                                                                      |
| `organizations` / `memberships`       | organizations-service | Not a projection — nothing else holds this data. NOT rebuildable; `infrastructure/postgres/operations/backfill-bootstrap-memberships.sh` reconciles it from `helpdesk_auth` (ADR 0013)                                                                                                                                                                            |
| `directory_memberships`               | users-service         | Projection of memberships from `membership.*.v1` events, so the directory can be scoped without a synchronous call on every read. Rebuild/reconcile: `infrastructure/postgres/operations/backfill-directory-memberships.sh` reads `helpdesk_organizations` — an operator action, which is why it may cross the database boundary that services may not (ADR 0003) |

### The tenant column, and what a rebuild has to do about it

Sprint 9.3 added a nullable `organization_id` to eight of the tables above —
`tickets`, `ticket_comments`, `ticket_history`, `suggestions`,
`ticket_snapshots`, `ticket_refs`, `notifications` and `audit_events` — and
backfilled every existing row to the bootstrap organization. It is an opaque
id with no foreign key, because organizations live in another database
(ADR 0003), and
`infrastructure/postgres/operations/verify-tenant-columns.sh` is what checks
that every one of them still resolves.

`user_profiles` deliberately did **not** get the column, and still does not:
it is projected from `user.registered`, which carries no tenant and cannot —
the membership that would supply one is created by consuming that very event
— and a single organization column on a profile would assert one-org-per-
person, which ADR 0013 rejected. The directory is scoped through the
`directory_memberships` projection instead. `user_snapshots` gained the
column in Sprint 9.4, fed by `membership.created.v1`.

The consumers now read the tenant-carrying stream (`*.v2` and
`membership.*.v1`), so rows written going forward carry their organization.
What a rebuild owes is unchanged in one respect: the documented rebuild paths
refetch over HTTP, and consumed events are gone — so **a rebuild must still
be followed by the tenant backfill**
(`infrastructure/postgres/operations/backfill-tenant-columns.sh`) unless the
refetch source itself supplies the organization, which today it does not.
That stays true until the rebuild procedures are re-scoped (R13), and it is
the reason the backfill script is idempotent rather than one-shot.

Since Sprint 9.6 there is a second store in that category: users-service's
profile columns and organization-defined field tables (ADR 0018). A person's
edited phone number exists nowhere else — no replay, no refetch and no
operator script brings it back. The registration consumer and the profile
API co-own `user_profiles` and must never overlap columns; the schema
comment names which columns belong to whom, and a test pins that a replayed
registration leaves profile columns alone.

`organizations` and `memberships` are the first data here that is neither a
projection nor a record of something that already happened. Every other store
above is one or the other: it has its source of truth elsewhere
(`helpdesk_tickets`, `helpdesk_auth`), or it is an append-only account of past
events whose value is historical. A membership is live access state and exists
nowhere else — losing one locks that person out of the organization, and no
replay brings it back (ADR 0013). `memberships.organization_id` is a real
foreign key because the organization sits in the same database;
`memberships.user_id` is an opaque uuid with no foreign key, because the user
does not.

The reconciliation procedure is
`infrastructure/postgres/operations/backfill-bootstrap-memberships.sh`. It
reads `helpdesk_auth.users` and inserts a bootstrap-organization membership for
every user that has none, insert-only and idempotent
(`ON CONFLICT DO NOTHING`), so a second run changes nothing and no existing
membership is ever modified. It is not a rebuild — there is no store to
rebuild from, only auth's user list to reconcile against. Two situations need
it.
organizations-service builds memberships by consuming `user.registered.v1`,
which reaches only registrations that happened after the service existed;
everyone who registered earlier is reachable only by the script. And publishing
is best-effort with no outbox (ADR 0006), so a registration during a broker
outage produces no event and no membership. A projection survives that: the
service that owns the source data can be asked again. A membership has no such
owner to ask, so the script is the only path back.

That is what makes the gap recorded above — auth-service exposes no user
listing yet — load-bearing rather than theoretical. Without such an endpoint
the only way to enumerate existing users is to read `helpdesk_auth` directly,
which no service may do (ADR 0003). The script is allowed to because it is an
operator action run by hand from outside the applications, not a runtime
coupling. The consequence is that the recovery path for the one store nothing
else can reproduce is a manual database procedure, and stays one until that
endpoint exists.

Three services read another service's data synchronously (ADR 0011), and the
edges are not the same shape. `ai-service` fetches a ticket from
`tickets-service` over HTTP, forwarding the caller's own access token, so it
can read nothing the person asking could not read themselves; it stores **no
ticket text** — only its own output plus a SHA-256 hash of the context that
produced it. `auth-service` calls `organizations-service` while minting an
access token, and that is the one call with no caller token to forward, since
minting is what produces one: it carries a service credential
(`INTERNAL_SERVICE_TOKEN`) in the `x-internal-service-token` header instead,
which is standing access rather than borrowed access. It keeps nothing from
the response — the membership it reads becomes claims in the token being
signed, not a row in `helpdesk_auth`. `tickets-service` calls
`organizations-service` with the same service credential before assigning a
ticket, and only then: assignment is a high-consequence mutation whose answer
must be true at the moment of use, which a claim or a projection cannot
promise (the amendment in ADR 0014 draws this boundary — mutations may
re-validate, read paths never call). It too keeps nothing from the response.
So none of `helpdesk_ai`, `helpdesk_auth` or `helpdesk_tickets` holds a copy
of anyone else's data of record, and the ownership rule above still holds
without exception.

Retention note: `helpdesk_audit` keeps event payloads (including
registration emails) indefinitely and the application exposes no deletion.
Any legal erasure request is an administrative database procedure outside
the application, executed by the platform operator.

## What this rules out

- Shared "common" tables or a shared ORM schema package.
- Cross-database joins, foreign data wrappers, or replication between service databases.
- One service running migrations against another service's database.
