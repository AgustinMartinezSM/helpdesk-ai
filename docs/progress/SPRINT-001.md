# Sprint 1 — Platform Foundation

Status: complete. Branch: `feature/HD-001-initialize-workspace`. Date: 2026-07-27.

## Goal

Deliver a production-oriented foundation that compiles, tests, documents itself, and runs locally. No business features: no authentication, no tickets, no AI capabilities. Everything domain-related is deferred to later sprints.

## Scope completed

- **Workspace**: Nx 23.1.0 monorepo with pnpm workspaces. pnpm 11.17.0 pinned via `packageManager` (installed globally with npm; Corepack intentionally not used). Node >= 24. TypeScript 6.0.3 strict with solution-style project references kept current by `nx sync`. Workspace scope `@helpdesk-ai`.
- **Applications (3 of a 10-app target)**:
  - `apps/web` — Next.js 16.2.12 (App Router), React 19.2.8. Minimal landing page. Port 3000.
  - `apps/web-bff` — NestJS 11.1.28 backend-for-frontend. Port 3001. CORS restricted to `http://localhost:3000` via `CORS_ALLOWED_ORIGINS`.
  - `apps/api-gateway` — NestJS 11.1.28. Port 3002. CORS intentionally not enabled (server-to-server only). Routes nothing yet; no downstream services exist.
- **Libraries (2)**:
  - `libs/configuration` — zod 4.4.3 environment validation. `baseEnvSchema`, `corsOriginsSchema`, `validateEnv` (fail-fast, reports all offending variables in a single `EnvValidationError`). Framework-agnostic.
  - `libs/observability` — nestjs-pino 4.6.1 structured JSON logging. `ObservabilityModule.forRoot` adds `service` and `environment` to every line; request lines carry `requestId`, `traceId`, method/url/status/responseTime. `correlationMiddleware` guarantees and echoes `x-request-id` / `x-trace-id`. This is request correlation, not distributed tracing.
- **Bootstrap pattern**: both Nest apps validate `process.env` before `NestFactory.create`; typed env enters DI through the `APP_ENV` token in `AppModule.forRoot(env)`. helmet, `bufferLogs`, shutdown hooks enabled.
- **Health endpoints**: `GET /health` (liveness) and `GET /health/ready` (readiness with `checks: []` — deliberately empty, since no external dependency is probed yet).
- **Infrastructure**: `compose.yaml` with postgres:18-alpine (host port 5433; native PG16 occupies 5432), redis:8-alpine (requirepass), rabbitmq:4.3-management-alpine. Health checks, named volumes, explicit network, local-only example credentials overridable via git-ignored `.env`.
- **Quality tooling**: husky commit-msg hook running commitlint (Conventional Commits) and pre-commit running lint-staged (eslint --fix + prettier). Both hooks verified against real commits.
- **Tests**: 19 passing (Jest 30 + @swc/jest) — config schema tests, correlation middleware unit tests, health endpoint integration tests with supertest, web landing test.
- **CI**: `.github/workflows/ci.yml` authored (pnpm install --frozen-lockfile, format:check, lint, test, build on ubuntu-latest / Node 24). Never executed — see below.

## Validation results

| Check                                                 | Result                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `typecheck`, `lint`, `format:check`, `test`, `build`  | All passing locally                                                                        |
| web-bff and api-gateway booted from production builds | Verified; `/health` and `/health/ready` answered over HTTP with correlation headers echoed |
| Fail-fast config validation                           | Verified: invalid `PORT` -> process exit 1 with per-variable errors                        |
| postgres container                                    | Healthy (`pg_isready`)                                                                     |
| redis container                                       | Healthy (`redis-cli ping` -> PONG)                                                         |
| rabbitmq container                                    | Healthy (`rabbitmq-diagnostics -q ping`); management UI returned HTTP 200                  |
| CI workflow on GitHub                                 | **NOT VERIFIED** — the repository has no remote; the workflow has never run                |

Containers were shut down after validation.

## Commit log

```
1dfb606 chore(repo): initialize repository with baseline configuration
c85db3b chore(workspace): initialize Nx monorepo with pnpm workspaces
8267171 feat(platform): scaffold web, web-bff and api-gateway applications
731adb9 feat(configuration): add zod-based environment validation library
c5c45e8 feat(observability): add structured logging and request correlation
a4b514b feat(platform): implement typed bootstrap, health endpoints and hardening
6a05d2b chore(infrastructure): add local service composition with health checks
60407de chore(tooling): configure code quality automation
d3d090a ci(github): add continuous integration workflow
```

Next commit: `docs(architecture): document platform foundation and initial decisions` (this documentation set).

## Deviations from plan

- **postgres:18 volume layout**: first boot failed with data mounted at `/var/lib/postgresql/data`. postgres:18 images moved the data directory; the fix is mounting `/var/lib/postgresql` (docker-library/postgres#1259). Fresh dev volumes were recreated.
- **@nestjs/config removed**: installed, evaluated, then replaced with the typed zod bootstrap (single validation point, config typed end to end). Revisit if per-module config namespaces become necessary.
- **Test commits folded**: tests landed inside their feature commits rather than one separate test commit.
- **AI-assistant template boilerplate rejected**: `create-nx-workspace` generated `.agents`, `.cursor`, `AGENTS.md`, `CLAUDE.md`, `.github/skills`, etc. None adopted.

## Intentionally deferred

- pino-pretty (logs stay JSON in dev)
- Global `ValidationPipe` (no DTOs yet)
- Rate limiting
- Swagger/OpenAPI (no business endpoints)
- Distributed tracing (spans, sampling, W3C traceparent) — to be designed separately
- e2e test projects
- Authentication and all domain services
- Push to remote / first CI run

## Risks

- **Nx 23 recency**: a recent major version; ecosystem plugins and documented workarounds may lag. Mitigation: pin versions, upgrade deliberately.
- **Single-developer bus factor**: all context lives with one person. Mitigation: this documentation set and Conventional Commit history.
- **CI unproven**: the workflow is authored but has never run on GitHub. First push may surface environment differences (cache keys, pnpm setup). Treat the first remote CI run as a task, not a formality.
