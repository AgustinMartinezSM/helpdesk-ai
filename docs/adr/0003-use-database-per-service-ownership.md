# ADR 0003: Database-per-Service Ownership

- Status: Accepted (decision standing; enforcement begins when the first domain service lands — no domain service or database is implemented yet)
- Date: 2026-07-27
- Sprint: 1

## Context

HelpDesk AI is a monorepo whose target architecture splits domain logic across multiple backend services (auth, users, tickets, ai, notification, audit, analytics — all planned, none implemented). The most common failure mode for this shape of system is a shared database: services start reading and writing each other's tables, schemas become an implicit contract nobody owns, and independent deployment and schema evolution become impossible. Once that coupling exists, it is expensive to unwind.

The decision therefore has to be made now, before the first domain service exists, so that data ownership is a rule the first migration follows rather than a refactor applied later.

Local constraint: the development machine has limited RAM and already runs an untouchable native PostgreSQL 16 on port 5432. The workspace's Docker composition runs a single `postgres:18-alpine` container on host port 5433.

## Decision

Each service exclusively owns its data. Concretely:

1. **Exclusive ownership.** A service's tables are private. No other service connects to its database, reads its tables, or depends on its schema.
2. **Separate credentials per service.** Each service gets its own database role and connection string. Credentials for one service cannot access another service's database.
3. **Separate migrations per service.** Each service manages its own migration history independently. There is no shared migration tool run across databases.
4. **No cross-service foreign keys.** Ever. References to entities owned by another service are stored as opaque identifiers, not enforced constraints.
5. **Integration paths.** Services integrate only through: synchronous APIs (via the api-gateway), versioned RabbitMQ events (e.g. `ticket.created.v1`), or locally-owned projections built from those events.
6. **Local topology.** Locally, one PostgreSQL 18 instance hosts one logical database per service — planned names: `helpdesk_auth`, `helpdesk_users`, `helpdesk_tickets`, `helpdesk_audit`, `helpdesk_analytics` — each with its own credentials and migration history. This is a RAM concession, not the model: a production-style deployment would use separate instances (or managed databases) per service. Ownership rules are identical in both topologies.

None of this is implemented. Sprint 1 delivered only the PostgreSQL container; the logical databases, roles, and migrations arrive with their owning services.

## Alternatives Considered

### Single shared schema

All services read and write one schema. Simplest to start, and cross-service joins are free. Rejected: every schema change becomes a cross-team negotiation, deployment coupling is total, and "who owns this table" degrades into archaeology. This is the exact outcome the ADR exists to prevent.

### Schema-per-service in one database with shared credentials

Namespacing without enforcement. Rejected: with shared credentials nothing stops a service from querying another service's schema, so the boundary is a convention that erodes under deadline pressure. Separate credentials make the boundary mechanical: a violating query fails at connection time.

### Instance-per-service locally

Highest production fidelity. Rejected for local development: five-plus PostgreSQL containers on a RAM-constrained machine is a real cost for a boundary that separate logical databases plus separate credentials already enforce. The properties that matter locally — exclusive access, independent migrations — hold either way.

## Consequences

- **Data duplication.** Services that need another service's data for reads maintain their own projections fed by events. Some data exists in more than one place by design.
- **Eventual consistency.** Projections lag their source of truth. Cross-service reads reflect the event stream, not a transactional snapshot. Features must be designed for this.
- **Joins become work.** A query that would be a `JOIN` in a shared schema becomes an API call, an event-fed projection, or both. This is the deliberate price of autonomy.
- **Per-service operational surface.** Each service brings its own credentials, migration history, and backup concerns. Locally this is one instance; in production it multiplies.

## Revisit Criteria

Revisit this decision if the operational overhead (projection maintenance, event plumbing, per-service database administration) demonstrably outweighs the autonomy gained — for example, if most services turn out to need most of each other's data and the system is effectively rebuilding a shared database out of projections.
