# Local Development Guide

Windows-first guide for running the HelpDesk AI platform locally. Current state (Sprint 2): four applications (`web`, `web-bff`, `api-gateway`, `auth-service`), two libraries (`configuration`, `observability`), and local infrastructure via Docker Compose. auth-service implements registration, login and rotating refresh sessions over its own `helpdesk_auth` database; no other domain features exist yet.

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

| Service                   | Host port                | Notes                                                                                                                                                     |
| ------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| web (Next.js)             | 3000                     | Dev server.                                                                                                                                               |
| web-bff (NestJS)          | 3001                     | `PORT` env. CORS restricted to `http://localhost:3000`.                                                                                                   |
| api-gateway (NestJS)      | 3002                     | CORS intentionally not enabled — server-to-server only, browsers never call it.                                                                           |
| auth-service (NestJS)     | 3003                     | Needs `apps/auth-service/.env` (JWT secret, DATABASE_URL) and the postgres container. Swagger UI at http://localhost:3003/docs outside production.        |
| ai-service (NestJS)       | 3009                     | Needs `apps/ai-service/.env` (same JWT secret, DATABASE_URL, TICKETS_SERVICE_URL, `AI_PROVIDER=local`) plus a running tickets-service. Swagger at /docs.  |
| PostgreSQL 18 (container) | 5433 -> 5432 (container) | Host port 5433 because this developer machine runs a native PostgreSQL 16 on 5432 that must not be touched. Connect to the container on `localhost:5433`. |
| Redis 8 (container)       | 6379                     | `requirepass` enabled.                                                                                                                                    |
| RabbitMQ 4.3 (container)  | 5672                     | AMQP.                                                                                                                                                     |
| RabbitMQ management UI    | 15672                    | http://localhost:15672 — default local login `helpdesk` / `helpdesk_local_only_rabbit` (overridable via git-ignored root `.env`).                         |

## Root commands

| Command                             | What it does                                                        |
| ----------------------------------- | ------------------------------------------------------------------- |
| `pnpm dev:web`                      | Serve the Next.js app on 3000.                                      |
| `pnpm dev:bff`                      | Serve web-bff on 3001.                                              |
| `pnpm dev:gateway`                  | Serve api-gateway on 3002.                                          |
| `pnpm lint`                         | ESLint across affected projects.                                    |
| `pnpm test`                         | Fast Jest suites — no Docker required (42 tests as of Sprint 2).    |
| `pnpm build`                        | Build all projects.                                                 |
| `pnpm typecheck`                    | TypeScript checks.                                                  |
| `pnpm format` / `pnpm format:check` | Prettier write / verify.                                            |
| `pnpm infra:up`                     | Start PostgreSQL, Redis and RabbitMQ containers with health checks. |
| `pnpm infra:down`                   | Stop the containers. Named volumes persist.                         |
| `pnpm infra:status`                 | Show container/health status.                                       |

Per-project target needing infrastructure:

```powershell
pnpm nx run @helpdesk-ai/auth-service:test-integration
```

Requires the postgres container (`pnpm infra:up`). It applies migrations to `helpdesk_auth_test` and runs the `*.int.spec.ts` suites (repositories plus the full HTTP auth flow) serially against the real database.

## Environment files

Convention: each service owns its environment.

- `apps/web-bff/.env.example`, `apps/api-gateway/.env.example` and `apps/auth-service/.env.example` document the variables each service reads.
- auth-service refuses to boot without `JWT_ACCESS_SECRET` (min 32 chars, no default on purpose) and a PostgreSQL `DATABASE_URL`. Copy its `.env.example` to `.env` and replace the secret placeholder before `pnpm dev:auth` — the example file shows a PowerShell one-liner to generate one.
- The root `.env.example` holds only Compose infrastructure overrides (credentials, etc.).
- Copy each `.env.example` to `.env` next to it. Real `.env` files are git-ignored.
- Nx loads the project-level `.env` automatically when serving — no extra tooling required.

Both Nest apps validate `process.env` with `validateEnv` (zod, from `@helpdesk-ai/configuration`) before `NestFactory.create`. Invalid config exits the process with code 1 and reports all offending variables in one error — fix everything it lists, not just the first line.

## Infrastructure lifecycle

```powershell
pnpm infra:up      # starts postgres:18-alpine, redis:8-alpine, rabbitmq:4.3-management-alpine
pnpm infra:status  # wait until every container reports healthy
# ... work ...
pnpm infra:down    # stop containers; named volumes persist, data survives
```

Health checks are built into `compose.yaml`: `pg_isready` (PostgreSQL), `redis-cli ping` (Redis), `rabbitmq-diagnostics -q ping` (RabbitMQ, 30s `start_period` — it is normal for RabbitMQ to report `starting` for a short while).

Credentials are non-default, local-only example values (e.g. `helpdesk_admin` / `helpdesk_local_only_pg`), overridable through a git-ignored root `.env`. Containers are prefixed `helpdesk-ai-` on an explicit `helpdesk-ai` network.

On first initialization of an empty postgres volume, `infrastructure/postgres/init` provisions the `auth_service` role plus the `helpdesk_auth` and `helpdesk_auth_test` databases. To re-provision: `pnpm infra:down`, `docker volume rm helpdesk-ai_postgres-data`, `pnpm infra:up`.

To verify a running Nest service:

```powershell
curl http://localhost:3001/health        # liveness
curl http://localhost:3001/health/ready  # readiness; bff/gateway: checks [] (nothing probed yet)
curl http://localhost:3003/health/ready  # auth-service: probes helpdesk_auth for real; 503 when the database is down
```

### Prisma workflow (auth-service)

Run from `apps/auth-service` with `DATABASE_URL` set in the shell (the CLI does not read Nx-loaded `.env` files):

```powershell
pnpm exec prisma migrate dev --name <change>   # new migration against helpdesk_auth (needs CREATEDB for the shadow DB)
pnpm exec prisma migrate deploy                # apply committed migrations
pnpm exec prisma generate                      # regenerate the client (also done by the cached prisma-generate target)
```

The generated client lives in `apps/auth-service/src/generated/` and is git-ignored; `build`, `test` and `typecheck` regenerate it automatically through the `prisma-generate` target.

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

- Do not run everything at once. Start only the app(s) you are working on; the gateway routes nothing yet, so it is rarely needed.
- Run `pnpm infra:down` when you finish — data persists in named volumes, and idle containers just consume memory.
