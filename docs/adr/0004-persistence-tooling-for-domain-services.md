# ADR 0004 — Persistence tooling for domain services

## Status

Proposed — awaiting product owner decision. Nothing is implemented; this ADR
exists to make the choice explicit before the first line of persistence code.

## Context

auth-service is the first service that needs a database (the `helpdesk_auth`
logical database defined in ADR 0003). Under our clean architecture rules the
domain layer must not depend on the ORM: repositories are ports defined by the
application/domain side, and the persistence tool lives in infrastructure
adapters only.

Constraints:

- TypeScript strict, NestJS 11, PostgreSQL 18.
- Per-service migrations and credentials (ADR 0003); no cross-service access.
- Integration tests must run against an isolated database.
- Windows-first development environment.
- Whatever is chosen here becomes the default for later services
  (users, tickets, audit, analytics) unless a future ADR overrides it.

Exact package versions will be verified against official documentation at
implementation time.

## Options considered

### 1. Prisma (recommended)

Schema-first: `schema.prisma` per service, generated fully-typed client,
`prisma migrate` for versioned SQL migrations.

- For: the generated client is plain data access with no entity decorators,
  which fits the repository-adapter pattern naturally (persistence models
  mapped to domain entities inside the adapter); migration workflow is the
  most reliable of the four; excellent documentation; typed queries catch
  drift at compile time.
- Against: no identity map or unit of work; complex queries may need
  `$queryRaw`; a query engine artifact ships with each service; the generated
  client must be regenerated on schema changes (build-step discipline).

### 2. MikroORM

Data-mapper ORM with unit of work and identity map, official NestJS module.

- For: the most DDD-friendly option — entities can stay close to domain
  objects, UoW gives transactional consistency; good migration support.
- Against: smaller community and hiring pool; decorator-based entities make it
  tempting to leak ORM annotations into the domain layer, which our rules
  forbid — requiring separate persistence entities and mapping anyway.

### 3. TypeORM

The classic NestJS default, decorator entities, mature ecosystem.

- Against (decisive): long-standing maintenance and migration-DX concerns;
  decorator entities invite exactly the domain-model coupling we prohibit.
  Familiarity is its main advantage, and that does not outweigh the rest.

### 4. Drizzle

TypeScript-first SQL query builder with `drizzle-kit` migrations.

- For: lightweight, no decorators, SQL stays visible, fast.
- Against: youngest option; more hand-written mapping between rows and domain
  objects; fewer established NestJS patterns for module wiring and testing.

## Decision

Pending. Recommendation: **Prisma**, because it keeps persistence strictly in
the infrastructure layer by construction, has the strongest migration story,
and is straightforward to defend and staff for. MikroORM is the serious
alternative if richer in-process domain mapping (UoW, identity map) becomes
more valuable than simplicity.

## Consequences (if the recommendation is accepted)

- Each service owns `prisma/schema.prisma` and its migrations directory;
  `helpdesk_auth` gets provisioned with dedicated credentials alongside the
  first migration.
- Repository interfaces stay in application/domain; Prisma appears only in
  infrastructure adapters and is mapped to domain types at that boundary.
- Integration tests run against the local PostgreSQL container (host port 5433) using a disposable schema or database per test run.

## Risks

- Prisma's generated-client step adds build complexity in the monorepo
  (mitigation: wire generation into the service's build target).
- Raw SQL escape hatches can erode the abstraction if unreviewed.

## Revisit conditions

- A service needs aggregate-heavy transactional behavior that UoW would
  simplify substantially (reopens MikroORM).
- Prisma licensing, pricing or maintenance direction changes materially.
