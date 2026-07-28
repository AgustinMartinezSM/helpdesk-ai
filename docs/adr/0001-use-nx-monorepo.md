# ADR 0001: Use an Nx Monorepo with pnpm Workspaces

## Status

Accepted — implemented in Sprint 1.

## Context

HelpDesk AI is a multi-service platform built by a one-person team. The target
architecture is ten applications (web, web-bff, api-gateway, plus seven planned
backend services) sharing common libraries for configuration, observability,
and — later — contracts and domain types. Sprint 1 delivered three applications
(`apps/web`, `apps/web-bff`, `apps/api-gateway`) and two libraries
(`libs/configuration`, `libs/observability`).

Requirements that drove the repository decision:

- One place to change shared code (env validation, logging, correlation) and
  see every consumer break immediately at typecheck time.
- A task graph with computation caching and `affected` commands, so that lint,
  test, and build only run for projects impacted by a change. This matters
  most for a single developer: CI minutes and local feedback loops are the
  scarcest resources.
- Code generators for scaffolding new applications and libraries consistently
  as the remaining seven services are added.
- Enforceable module boundaries between apps and libs (Nx tags and lint
  rules), so service isolation is a lint failure rather than a convention.
- Strict, disk-efficient dependency installation with a single lockfile.

## Decision

Use a single repository managed by **Nx 23.1.0** with **pnpm workspaces**
(pnpm 11.17.0, pinned via the `packageManager` field; installed globally with
npm — Corepack is intentionally not used). Node >= 24. TypeScript 6.0.3 in
strict mode with solution-style project references kept current by `nx sync`.
Workspace package scope is `@helpdesk-ai`.

pnpm provides the workspace protocol, a strict (non-flat) `node_modules`
layout, and a content-addressable store. Nx sits on top for the task graph,
caching, `affected`, generators, and boundary enforcement. pnpm 11 blocks
dependency build scripts by default; the allow-list lives in
`pnpm-workspace.yaml`.

## Alternatives Considered

### Polyrepo (one repository per service)

Rejected. Sharing `libs/configuration` and `libs/observability` would require
publishing versioned packages and coordinating upgrades across ten repos —
pure overhead for a one-person team. Cross-cutting changes (e.g. a logging
field added to every service) would become multi-repo, multi-PR operations.
Polyrepo pays off with many independent teams; that is not this project.

### Plain pnpm workspaces without Nx

Rejected. pnpm workspaces alone solve linking and installation but provide no
task graph, no caching, no `affected`, no generators, and no module boundary
enforcement. Each of those would need to be rebuilt from scripts and custom
lint rules. The cost of Nx (one dev dependency and its conventions) is lower
than the cost of reimplementing its features.

### Turborepo

Rejected for this project. Turborepo covers task running and caching well, but
it has no code generators comparable to Nx's application/library scaffolding
and no built-in module boundary enforcement. With seven more services planned,
generators and enforced boundaries weigh more than Turborepo's smaller
footprint.

## Consequences

- Single lockfile, single install, single TypeScript version across all
  projects. Dependency drift between services is impossible by construction.
- `nx affected` limits lint/test/build to changed projects; the local cache
  makes repeated runs near-instant. The CI workflow
  (`.github/workflows/ci.yml`) uses `pnpm install --frozen-lockfile` and runs
  format check, lint, test, and build workspace-wide.
- Shared libraries are consumed directly from source via project references —
  no publishing pipeline needed.
- New services will be scaffolded with Nx generators, keeping structure
  uniform across the remaining seven planned applications.
- Everything ships from one branch history; there is no per-service release
  cadence. Acceptable now, since services are not independently deployed yet.

## Risks

- **Nx coupling.** Build orchestration, project configuration, and TypeScript
  reference syncing all flow through Nx. Migrating away later would mean
  rebuilding the task pipeline. Mitigation: keep project code
  framework-agnostic (e.g. `libs/configuration` has no Nx or NestJS
  dependency); Nx touches tooling, not runtime code.
- **Major-version migrations.** Nx majors ship breaking changes to config and
  executors; `nx migrate` automates most of it but the workspace must move as
  one unit — no gradual, per-service upgrades.
- **Monorepo scale.** With many services, graph computation and CI times can
  grow. Not a problem at 3 apps + 2 libs; remote caching (Nx Cloud or
  self-hosted) is the known escape hatch and is intentionally deferred.

## Revisit Conditions

Revisit this decision if any of the following happens:

- The team grows to multiple squads owning services with independent release
  cadences (polyrepo or a hybrid becomes viable).
- A service needs a runtime or language outside the Node/TypeScript toolchain
  that Nx handles poorly.
- Nx licensing, maintenance, or migration costs outweigh its task-graph and
  generator benefits, at which point plain pnpm workspaces plus a lighter task
  runner would be re-evaluated.
