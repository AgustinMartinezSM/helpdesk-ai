# HelpDesk AI

HelpDesk AI is a help desk platform for managing support requests. The long-term goal is to assist support teams with AI: ticket summarization, classification, priority suggestion, suggested replies, and duplicate detection. All AI features are planned; none are implemented yet.

The repository is at an early stage (Sprint 2). What exists today: an Nx monorepo with four applications, two shared libraries (environment validation, structured logging with request correlation), local infrastructure via Docker Compose, code quality automation, and a working authentication service (registration, login, rotating refresh sessions) backed by its own PostgreSQL database. There is no ticket domain yet.

## Current status

| Area                                                                                          | Status                 |
| --------------------------------------------------------------------------------------------- | ---------------------- |
| Nx 23 monorepo with pnpm workspaces, TypeScript strict + project references                   | Implemented            |
| `apps/web` — Next.js 16 frontend with login and account pages                                 | Implemented            |
| `apps/web-bff` — browser sessions (`/session/*`, httpOnly refresh cookie)                     | Implemented            |
| `apps/api-gateway` — routes `/api/auth/*` to auth-service                                     | Implemented            |
| `libs/configuration` — zod-based fail-fast env validation                                     | Implemented            |
| `libs/observability` — structured JSON logs, request correlation                              | Implemented            |
| Health endpoints (`/health`, `/health/ready`) on both Nest apps                               | Implemented            |
| Local infrastructure: PostgreSQL 18, Redis 8, RabbitMQ 4.3 (compose)                          | Implemented            |
| CI workflow (committed; never executed — repo has no remote)                                  | Implemented            |
| `apps/auth-service` — registration, login, rotating refresh sessions (port 3003)              | Implemented            |
| `helpdesk_auth` database (Prisma 7, argon2id, JWT, reuse detection)                           | Implemented            |
| `apps/tickets-service` — ticket lifecycle, comments, history (port 3004)                      | Implemented            |
| Users, tickets, notifications, audit, analytics services                                      | Planned                |
| AI features (summarization, classification, priority, suggested replies, duplicate detection) | Planned                |
| RabbitMQ versioned events between services                                                    | Planned                |
| Distributed tracing, rate limiting, Swagger, e2e tests                                        | Intentionally deferred |

Target architecture: `web -> web-bff -> api-gateway -> {auth, users, tickets, ai, notification, audit, analytics}` — synchronous HTTP for request/response, RabbitMQ events for facts (planned). The login path is live end to end: the web app signs in through the BFF, which calls auth-service through the gateway.

## Prerequisites

- Node.js >= 24
- pnpm 11 (pinned via `packageManager` in `package.json`; installed globally with npm — Corepack is not used)
- Docker Desktop (for local PostgreSQL, Redis, RabbitMQ)

Note: containerized PostgreSQL maps to host port **5433** to avoid clashing with a native PostgreSQL on 5432.

## Quickstart

```sh
pnpm install          # install workspace dependencies
pnpm infra:up         # start PostgreSQL, Redis, RabbitMQ (compose.yaml)
pnpm infra:status     # verify containers are healthy

pnpm dev:web          # Next.js frontend       -> http://localhost:3000
pnpm dev:bff          # web-bff (NestJS)       -> http://localhost:3001
pnpm dev:gateway      # api-gateway (NestJS)   -> http://localhost:3002
pnpm dev:auth         # auth-service (NestJS)  -> http://localhost:3003 (needs its .env — see below)
```

auth-service requires `apps/auth-service/.env` (copy from `.env.example`; `JWT_ACCESS_SECRET` has no default on purpose) and the postgres container. Its Swagger UI is at http://localhost:3003/docs outside production. See [docs/api/auth-service.md](docs/api/auth-service.md).

Health checks:

- http://localhost:3001/health and http://localhost:3001/health/ready
- http://localhost:3002/health and http://localhost:3002/health/ready
- http://localhost:3003/health and http://localhost:3003/health/ready

Readiness never claims checks it does not run: bff and gateway report `checks: []` (they call no backing service yet), while auth-service probes its database for real and answers 503 when it is down.

Each Nest app has its own `.env.example`; copy to `.env` as needed. The root `.env.example` covers only compose infrastructure overrides. Real `.env` files are git-ignored.

## Repository layout

```
helpdesk-ai/
├── apps/
│   ├── web/            # Next.js frontend (port 3000)
│   ├── web-bff/        # NestJS backend-for-frontend (port 3001)
│   ├── api-gateway/    # NestJS entry point (port 3002)
│   └── auth-service/   # NestJS authentication service (port 3003, owns helpdesk_auth)
├── libs/
│   ├── configuration/  # @helpdesk-ai/configuration — zod env validation
│   └── observability/  # @helpdesk-ai/observability — logging + correlation
├── docs/
│   ├── architecture/   # platform and architecture documentation
│   └── adr/            # architecture decision records
├── compose.yaml        # local PostgreSQL, Redis, RabbitMQ
└── .github/workflows/  # CI pipeline
```

## Commands

| Command             | Description                             |
| ------------------- | --------------------------------------- |
| `pnpm dev:web`      | Serve the Next.js frontend on port 3000 |
| `pnpm dev:bff`      | Serve web-bff on port 3001              |
| `pnpm dev:gateway`  | Serve api-gateway on port 3002          |
| `pnpm dev:auth`     | Serve auth-service on port 3003         |
| `pnpm test`         | Fast Jest suites (no Docker needed)     |
| `pnpm lint`         | Lint all projects                       |
| `pnpm typecheck`    | Type-check all projects                 |
| `pnpm build`        | Build all projects                      |
| `pnpm format`       | Format the codebase with Prettier       |
| `pnpm format:check` | Check formatting without writing        |
| `pnpm infra:up`     | Start local infrastructure containers   |
| `pnpm infra:down`   | Stop local infrastructure containers    |
| `pnpm infra:status` | Show infrastructure container status    |

Integration tests against real PostgreSQL (needs `pnpm infra:up` first):

```sh
pnpm nx run @helpdesk-ai/auth-service:test-integration
```

Commits follow Conventional Commits, enforced by commitlint (husky `commit-msg` hook). A pre-commit hook runs lint-staged (`eslint --fix` + Prettier on staged files).

## Documentation

- `docs/architecture/` — platform foundation, target architecture, observability, infrastructure
- `docs/adr/` — architecture decision records
- `CONTRIBUTING.md` — workflow, branching, commit conventions
- `SECURITY.md` — security posture and reporting
