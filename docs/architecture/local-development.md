# Local Development Guide

Windows-first guide for running the HelpDesk AI platform locally. Current state (Sprint 9.2): eleven applications (`web`, `web-bff`, `api-gateway`, `auth-service`, `tickets-service`, `users-service`, `audit-service`, `notification-service`, `analytics-service`, `ai-service`, `organizations-service`), four libraries (`configuration`, `messaging`, `observability`, `security`), and local infrastructure via Docker Compose. Each domain service owns one database (ADR 0003) and reaches the others over RabbitMQ. Everything described here has only ever run on a developer machine and in CI; nothing is deployed anywhere.

## Prerequisites

| Tool           | Version                                   | Notes                                                                               |
| -------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| Node.js        | >= 24 (dev machine: v24.18.0)             | Required by the workspace `engines` constraint.                                     |
| pnpm           | 11 (pinned: 11.17.0 via `packageManager`) | Install globally with `npm install -g pnpm@11`. Corepack is intentionally not used. |
| Docker Desktop | Current stable, WSL2 backend              | Needed only for local infrastructure (`compose.yaml`).                              |
| Git            | Current stable                            | Conventional Commits enforced by commitlint (husky `commit-msg` hook).              |

After cloning:

```powershell
pnpm install --frozen-lockfile
```

## Ports

| Service                        | Host port                | Notes                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web (Next.js)                  | 3000                     | Dev server.                                                                                                                                                                                                                                                                                                                                                                 |
| web-bff (NestJS)               | 3001                     | `PORT` env. CORS restricted to `http://localhost:3000`.                                                                                                                                                                                                                                                                                                                     |
| api-gateway (NestJS)           | 3002                     | CORS intentionally not enabled — server-to-server only, browsers never call it.                                                                                                                                                                                                                                                                                             |
| auth-service (NestJS)          | 3003                     | Needs `apps/auth-service/.env` (JWT secret, DATABASE_URL, and `ORGANIZATIONS_SERVICE_URL` + `INTERNAL_SERVICE_TOKEN` if tokens should carry the tenant claims) and the postgres container. Swagger UI at http://localhost:3003/docs outside production.                                                                                                                     |
| tickets-service (NestJS)       | 3004                     | Needs `apps/tickets-service/.env` (same JWT secret, DATABASE_URL, RABBITMQ_URL) plus the postgres and RabbitMQ containers; it publishes the ticket lifecycle events. Swagger at /docs outside production.                                                                                                                                                                   |
| users-service (NestJS)         | 3005                     | Same env shape as tickets-service. Consumes `user.registered.v1` into its own database. Swagger at /docs outside production.                                                                                                                                                                                                                                                |
| audit-service (NestJS)         | 3006                     | Same env shape. Consumes every domain event into its own database. Swagger at /docs outside production.                                                                                                                                                                                                                                                                     |
| notification-service (NestJS)  | 3007                     | Same env shape. Consumes the ticket lifecycle events. Swagger at /docs outside production.                                                                                                                                                                                                                                                                                  |
| analytics-service (NestJS)     | 3008                     | Same env shape. Consumes ticket and user events. Swagger at /docs outside production.                                                                                                                                                                                                                                                                                       |
| ai-service (NestJS)            | 3009                     | Needs `apps/ai-service/.env` (same JWT secret, DATABASE_URL, TICKETS_SERVICE_URL, `AI_PROVIDER`) plus a running tickets-service. `AI_PROVIDER=local` is the recommended default for local work and CI: no key, no network, no spend. `AI_PROVIDER=gemini` also needs `GEMINI_API_KEY` (startup fails fast without it) and optionally `GEMINI_MODEL`. Swagger at /docs.      |
| organizations-service (NestJS) | 3010                     | Needs `apps/organizations-service/.env` (DATABASE_URL, RABBITMQ_URL, INTERNAL_SERVICE_TOKEN) plus the postgres and RabbitMQ containers. No `JWT_ACCESS_SECRET`: it has no person-facing endpoint and verifies no access tokens. Deliberately absent from the api-gateway routing table — only auth-service calls it, server to server. Swagger at /docs outside production. |
| PostgreSQL 18 (container)      | 5433 -> 5432 (container) | Host port 5433 because this developer machine runs a native PostgreSQL 16 on 5432 that must not be touched. Connect to the container on `localhost:5433`.                                                                                                                                                                                                                   |
| Redis 8 (container)            | 6379                     | `requirepass` enabled.                                                                                                                                                                                                                                                                                                                                                      |
| RabbitMQ 4.3 (container)       | 5672                     | AMQP.                                                                                                                                                                                                                                                                                                                                                                       |
| RabbitMQ management UI         | 15672                    | http://localhost:15672 — default local login `helpdesk` / `helpdesk_local_only_rabbit` (overridable via git-ignored root `.env`).                                                                                                                                                                                                                                           |

## Root commands

| Command                             | What it does                                                        |
| ----------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev:web`                      | Serve the Next.js app on 3000.                                      |
| `pnpm dev:bff`                      | Serve web-bff on 3001.                                              |
| `pnpm dev:gateway`                  | Serve api-gateway on 3002.                                          |
| `pnpm lint`                         | ESLint across affected projects.                                    |
| `pnpm test`                         | Fast Jest suites across every project — no Docker required.         |
| `pnpm build`                        | Build all projects.                                                 |
| `pnpm typecheck`                    | TypeScript checks.                                                  |
| `pnpm format` / `pnpm format:check` | Prettier write / verify.                                            |
| `pnpm infra:up`                     | Start PostgreSQL, Redis and RabbitMQ containers with health checks. |
| `pnpm infra:down`                   | Stop the containers. Named volumes persist.                         |
| `pnpm infra:status`                 | Show container/health status.                                       |

Per-project targets needing infrastructure. Nine projects have an integration suite:

```powershell
pnpm nx run @helpdesk-ai/auth-service:test-integration
```

The other eight are `@helpdesk-ai/messaging` and the tickets, users, audit, notification, analytics, ai and organizations services. Start the containers first (`pnpm infra:up`): the services need postgres, and `messaging` and every event consumer need RabbitMQ as well. A service target applies migrations to its own `*_test` database and runs the `*.int.spec.ts` suites serially against the real database — for auth-service, the repositories plus the full HTTP auth flow. CI runs the nine one project at a time.

## Environment files

Convention: each service owns its environment.

- Every app has an `apps/<app>/.env.example` documenting the variables it reads — all eleven of them, `web` included.
- auth-service refuses to boot without `JWT_ACCESS_SECRET` (min 32 chars, no default on purpose) and a PostgreSQL `DATABASE_URL`. Copy its `.env.example` to `.env` and replace the secret placeholder before `pnpm dev:auth` — the example file shows a PowerShell one-liner to generate one.
- The root `.env.example` holds only Compose infrastructure overrides (credentials, etc.).
- Copy each `.env.example` to `.env` next to it. Real `.env` files are git-ignored.
- Nx loads the project-level `.env` automatically when serving — no extra tooling required.

Every Nest app validates `process.env` with `validateEnv` (zod, from `@helpdesk-ai/configuration`) before `NestFactory.create`. Invalid config exits the process with code 1 and reports all offending variables in one error — fix everything it lists, not just the first line.

## Infrastructure lifecycle

```powershell
pnpm infra:up      # starts postgres:18-alpine, redis:8-alpine, rabbitmq:4.3-management-alpine
pnpm infra:status  # wait until every container reports healthy
# ... work ...
pnpm infra:down    # stop containers; named volumes persist, data survives
```

Health checks are built into `compose.yaml`: `pg_isready` (PostgreSQL), `redis-cli ping` (Redis), `rabbitmq-diagnostics -q ping` (RabbitMQ, 30s `start_period` — it is normal for RabbitMQ to report `starting` for a short while).

Credentials are non-default, local-only example values (e.g. `helpdesk_admin` / `helpdesk_local_only_pg`), overridable through a git-ignored root `.env`. Containers are prefixed `helpdesk-ai-` on an explicit `helpdesk-ai` network.

On first initialization of an empty postgres volume, `infrastructure/postgres/init` provisions one role and two databases per data-owning service — eight sets in all: the `auth_service` role with `helpdesk_auth` and `helpdesk_auth_test`, and the same pattern for tickets, users, audit, notifications, analytics, ai and organizations. To re-provision: `pnpm infra:down`, `docker volume rm helpdesk-ai_postgres-data`, `pnpm infra:up`.

To verify a running Nest service:

```powershell
curl http://localhost:3001/health        # liveness
curl http://localhost:3001/health/ready  # readiness; bff/gateway: checks [] (nothing probed yet)
curl http://localhost:3003/health/ready  # auth-service: probes helpdesk_auth for real; 503 when the database is down
curl http://localhost:3010/health/ready  # organizations-service: same, against helpdesk_organizations
```

Every Nest service exposes the same pair — swap the port for the one you are running (3004 through 3009 for tickets, users, audit, notification, analytics and ai). The services that own a database probe it in readiness, so a 503 there usually means postgres is down rather than the service.

### Prisma workflow

Eight services have a Prisma schema: auth, tickets, users, audit, notification, analytics, ai and organizations. Run from the service directory with `DATABASE_URL` set in the shell (the CLI does not read Nx-loaded `.env` files) — `apps/auth-service` below:

```powershell
pnpm exec prisma migrate dev --name <change>   # new migration against helpdesk_auth (needs CREATEDB for the shadow DB)
pnpm exec prisma migrate deploy                # apply committed migrations
pnpm exec prisma generate                      # regenerate the client (also done by the cached prisma-generate target)
```

The generated client lives in `apps/<service>/src/generated/` and is git-ignored; `build`, `test` and `typecheck` regenerate it automatically through the `prisma-generate` target.

For organizations-service, `prisma migrate deploy` is also what inserts the bootstrap organization. That row is written by `apps/organizations-service/prisma/migrations/20260730161500_bootstrap_organization/`, not by a seed script: there is no seed mechanism in this repository, and CI has to end up with the same data a developer has, so the migration is the only provisioning step both environments run. A database with its migrations applied already has the organization — nothing extra to run.

## Troubleshooting

### pnpm blocked build scripts

pnpm 11 blocks dependency post-install build scripts by default. The allow-list lives in `pnpm-workspace.yaml` (`allowBuilds`): `@parcel/watcher`, `@prisma/client`, `@prisma/engines`, `@swc/core`, `argon2`, `nx`, `prisma`, `sharp`, `unrs-resolver` (`less` and the `@scarf/scarf` install telemetry are deliberately blocked). If a newly added dependency needs its build script, add it there explicitly — do not blanket-approve.

### Stale TypeScript project references

The workspace uses solution-style TypeScript project references. If the editor or `typecheck` complains about missing/incorrect references after adding or moving projects:

```powershell
pnpm nx sync
```

### postgres:18 volume layout

The `postgres:18` image changed its data layout: the volume must mount at `/var/lib/postgresql`, not `/var/lib/postgresql/data` (docker-library/postgres#1259). `compose.yaml` already does this. If you copied an older compose snippet and PostgreSQL fails on first boot, fix the mount path and recreate the volume.

### Port 5432 conflicts

Do not remap the PostgreSQL container to 5432 — the native PostgreSQL 16 install on this machine owns that port. Always use 5433 in connection strings targeting the container.

### Native modules and webpack bundles

auth-service excludes `argon2` from its webpack bundle (`apps/auth-service/webpack.config.js`): native N-API modules must be required from `node_modules` at runtime — inlining them breaks prebuilt-binary resolution. If a future service adds a native dependency, replicate that externals pattern. Note that `NxAppWebpackPlugin` overwrites root-level `externals`, so the exclusion is appended by a small plugin that runs after it.

### Resource-aware tips

- Do not run everything at once. Start only the app(s) you are working on. The gateway proxies seven services (`/api/auth`, `/api/tickets`, `/api/users`, `/api/audit`, `/api/notifications`, `/api/analytics`, `/api/ai`), so it is needed only when you exercise a request path that goes through it — calling a service directly on its own port does not need it. organizations-service is deliberately absent from that table: nothing reaches it from a browser, only auth-service does, server to server.
- organizations-service has to be running for auth-service to stamp the tenant claims (`org`, `perms`, `mv`) on an access token, with `ORGANIZATIONS_SERVICE_URL` pointing at it and the same `INTERNAL_SERVICE_TOKEN` set on both sides. It is not required for login: with organizations-service down, or with `INTERNAL_SERVICE_TOKEN` unset in auth-service, login and refresh still return 200 and the token is minted without those claims, with a warning in the auth logs. Nothing downstream reads them yet, so start it only when working on tenancy.
- Run `pnpm infra:down` when you finish — data persists in named volumes, and idle containers just consume memory.
