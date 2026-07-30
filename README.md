# HelpDesk AI

HelpDesk AI is a support operations platform: centralize requests,
assist support teams, automate repetitive analysis, and keep humans in
control of every important decision. AI assistance — summarization,
classification, priority suggestion and suggested replies — is
implemented behind a provider port and shown to staff as a panel on the
ticket; a deployment supplies its own model-provider credentials before
it answers with anything but the built-in deterministic provider.
Duplicate detection is still designed but not built.

It is a portfolio project by Agustín Martínez, built with the discipline
of a production system: architecture decisions are written down before
code, every sprint ends with a full quality gate and an adversarial
review, and nothing is presented as working unless it is.

## Current status

Sprints 1–9.2 complete. Eleven applications and four libraries in an Nx
monorepo, an event-driven platform on RabbitMQ, an accessible product UI
and a complete public product experience.

| Area                                                                                               | Status              |
| -------------------------------------------------------------------------------------------------- | ------------------- |
| Nx 23 monorepo, pnpm workspaces, TypeScript strict + project references                            | Implemented         |
| `apps/web` — public product site + authenticated product UI (port 3000)                            | Implemented         |
| `apps/web-bff` — browser sessions, httpOnly refresh cookie (port 3001)                             | Implemented         |
| `apps/api-gateway` — single platform entry point (port 3002)                                       | Implemented         |
| `apps/auth-service` — registration, login, rotating refresh sessions (port 3003)                   | Implemented         |
| `apps/tickets-service` — lifecycle, comments, internal notes, history (port 3004)                  | Implemented         |
| `apps/users-service` — user profile projections (port 3005)                                        | Implemented         |
| `apps/audit-service` — immutable event trail, admin-only (port 3006)                               | Implemented         |
| `apps/notification-service` — in-app notifications (port 3007)                                     | Implemented         |
| `apps/analytics-service` — dashboard projections, staff-only (port 3008)                           | Implemented         |
| `apps/ai-service` — staff-only AI suggestions, provider-agnostic (port 3009)                       | Implemented         |
| `apps/organizations-service` — organizations and memberships, internal-only (port 3010)            | Implemented         |
| `libs/messaging` — versioned event contracts, RabbitMQ topology, DLQs                              | Implemented         |
| `libs/security` — JWT guard, actor model, role helpers                                             | Implemented         |
| `libs/configuration` — zod-based fail-fast env validation                                          | Implemented         |
| `libs/observability` — structured JSON logs, request correlation                                   | Implemented         |
| Design system, dark mode, accessible product UI                                                    | Implemented         |
| Public product experience (landing, how-it-works, features, security, about, engineering, contact) | Implemented         |
| Local infrastructure: PostgreSQL 18, Redis 8, RabbitMQ 4.3 (compose)                               | Implemented         |
| Notifications and analytics **product UI** (APIs exist, UI pending)                                | Planned             |
| AI summaries, classification, priority and reply drafts (staff panel on a ticket)                  | API ready           |
| Model provider: Google Gemini behind the `AiProvider` port (ADR 0010)                              | Implemented         |
| AI usage ceilings, key rotation and rate limiting (needed before a public deployment)              | Planned             |
| AI duplicate detection (needs embeddings and similarity search)                                    | Planned             |
| Self-service signup, assignee picker, attachments                                                  | Planned             |
| Transactional outbox for event publishing                                                          | Deferred (ADR 0006) |
| Distributed tracing, gateway rate limiting                                                         | Deferred            |
| CI on GitHub Actions: gate + 9 integration suites, green on a remote runner                        | Implemented         |

Architecture: `web → web-bff → api-gateway → {auth, tickets, users, ai}`
over HTTP for commands, with domain events on RabbitMQ consumed by
`{audit, notification, analytics, organizations}`. Each service owns its
own PostgreSQL database. Two service-to-service HTTP calls are documented
rather than hidden: `ai-service` reads a ticket from `tickets-service`,
forwarding the caller's own token, because the event contracts carry no
ticket text (ADR 0011); and `auth-service` asks `organizations-service`
for a membership while it mints a token, the one moment when there is no
caller token to forward. Neither call goes through the gateway, and
`organizations-service` is absent from its routing table on purpose — a
browser has no path to it.

## Prerequisites

- Node.js >= 24
- pnpm 11 (pinned via `packageManager`; installed globally with npm — Corepack is not used)
- Docker Desktop (for local PostgreSQL, Redis, RabbitMQ)

Note: containerized PostgreSQL maps to host port **5433** to avoid
clashing with a native PostgreSQL on 5432.

## Quickstart

```sh
pnpm install          # install workspace dependencies
pnpm infra:up         # start PostgreSQL, Redis, RabbitMQ (compose.yaml)
pnpm infra:status     # verify containers are healthy
```

The public site runs on its own:

```sh
pnpm dev:web          # http://localhost:3000
```

For the authenticated product (sign in, tickets) also start the session
path — each service needs its `.env` (copy from its `.env.example`):

```sh
pnpm dev:bff          # web-bff       -> http://localhost:3001
pnpm dev:gateway      # api-gateway   -> http://localhost:3002
pnpm dev:auth         # auth-service  -> http://localhost:3003
pnpm nx serve @helpdesk-ai/tickets-service   # -> http://localhost:3004
pnpm nx serve @helpdesk-ai/users-service     # -> http://localhost:3005
pnpm nx serve @helpdesk-ai/organizations-service   # -> http://localhost:3010
```

`JWT_ACCESS_SECRET` has no default on purpose: auth-service refuses to
boot without one. `organizations-service` is optional today: with it
stopped, or with no `INTERNAL_SERVICE_TOKEN` set on auth-service, login
and refresh still succeed — the access token is simply minted without its
organization claims and a warning is logged. Nothing in the platform
reads those claims yet. Swagger UI is available per service at `/docs`
outside production — see
[docs/api/auth-service.md](docs/api/auth-service.md).

Users created before organizations existed have no membership.
`infrastructure/postgres/operations/backfill-bootstrap-memberships.sh` gives
them one in the bootstrap organization: it reads `helpdesk_auth`, writes
`helpdesk_organizations`, is idempotent, and is run by an operator rather
than by a service. It is also the recovery path if a registration event is
lost to a broker outage — unlike every other store here, memberships cannot
be rebuilt from the event log.

Health checks live at `/health` and `/health/ready` on every Nest app.
Readiness never claims checks it does not run.

Optional public-site configuration (all links are hidden when unset, so
the site never ships a dead link):

| Variable                    | Effect                                                     |
| --------------------------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_SITE_URL`      | Canonical site URL for metadata                            |
| `NEXT_PUBLIC_GITHUB_URL`    | Shows GitHub links (repo: `AgustinMartinezSM/helpdesk-ai`) |
| `NEXT_PUBLIC_LINKEDIN_URL`  | Shows the LinkedIn link                                    |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Shows email links and the contact `mailto:` handoff        |

## Repository layout

```
helpdesk-ai/
├── apps/
│   ├── web/                   # Next.js — (public) site + (app) product UI (3000)
│   ├── web-bff/               # NestJS backend-for-frontend (3001)
│   ├── api-gateway/           # NestJS platform entry point (3002)
│   ├── auth-service/          # owns helpdesk_auth (3003)
│   ├── tickets-service/       # owns helpdesk_tickets (3004)
│   ├── users-service/         # owns helpdesk_users (3005)
│   ├── audit-service/         # owns helpdesk_audit (3006)
│   ├── notification-service/  # owns helpdesk_notifications (3007)
│   ├── analytics-service/     # owns helpdesk_analytics (3008)
│   ├── ai-service/            # owns helpdesk_ai (3009)
│   └── organizations-service/ # owns helpdesk_organizations (3010)
├── libs/
│   ├── messaging/             # event contracts, RabbitMQ topology, DLQs
│   ├── security/              # JWT guard, actor, role helpers
│   ├── configuration/         # zod env validation
│   └── observability/         # logging + request correlation
├── docs/
│   ├── architecture/          # platform, frontend, messaging, data ownership
│   ├── adr/                   # architecture decision records
│   ├── api/                   # service API documentation
│   └── progress/              # sprint logs
├── infrastructure/
│   └── postgres/
│       ├── init/              # roles and databases, first volume init only
│       └── operations/        # operator scripts (membership backfill)
├── compose.yaml               # local PostgreSQL, Redis, RabbitMQ
└── .github/workflows/         # CI pipeline
```

## Commands

| Command                                         | Description                         |
| ----------------------------------------------- | ----------------------------------- |
| `pnpm dev:web`                                  | Serve the Next.js app on port 3000  |
| `pnpm dev:bff`                                  | Serve web-bff on port 3001          |
| `pnpm dev:gateway`                              | Serve api-gateway on port 3002      |
| `pnpm dev:auth`                                 | Serve auth-service on port 3003     |
| `pnpm test`                                     | Fast Jest suites (no Docker needed) |
| `pnpm lint`                                     | Lint all projects                   |
| `pnpm typecheck`                                | Type-check all projects             |
| `pnpm build`                                    | Build all projects                  |
| `pnpm format`                                   | Format the codebase with Prettier   |
| `pnpm format:check`                             | Check formatting without writing    |
| `pnpm infra:up` / `infra:down` / `infra:status` | Manage local infrastructure         |

Full gate (what every sprint must pass):

```sh
pnpm nx run-many -t lint,test,build,typecheck
```

Integration tests against real PostgreSQL and RabbitMQ (needs
`pnpm infra:up` first), for example:

```sh
pnpm nx run @helpdesk-ai/tickets-service:test-integration
```

Commits follow Conventional Commits, enforced by commitlint (husky
`commit-msg` hook). A pre-commit hook runs lint-staged (`eslint --fix` +
Prettier on staged files).

## Documentation

- `docs/architecture/` —
  [product vision](docs/architecture/product-vision.md), system context,
  service boundaries, messaging, data ownership, observability, local
  development,
  [frontend design system](docs/architecture/frontend-design-system.md),
  [frontend routes](docs/architecture/frontend-public-routes.md), and the
  tenancy set: [current state](docs/architecture/tenancy-current-state.md),
  [target state](docs/architecture/tenancy-target-state.md),
  [threat model](docs/architecture/tenancy-threat-model.md),
  [migration plan](docs/architecture/tenancy-migration-plan.md)
- `docs/adr/` — architecture decision records (monorepo, BFF vs gateway,
  database ownership, persistence tooling, messaging, deferred outbox,
  public/authenticated split, contact delivery, product status
  representation, AI provider abstraction, AI ticket context access, and the
  six tenancy decisions: tenant isolation model, organization and membership
  ownership, active organization context, permission model, branch and
  operational station model, authentication identifiers versus profile
  attributes)
- `docs/progress/` — sprint logs
- `CONTRIBUTING.md` — workflow, branching, commit conventions
- `SECURITY.md` — security posture and reporting
