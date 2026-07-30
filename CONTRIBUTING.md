# Contributing

This guide covers the day-to-day workflow for working in this repository. For architecture and platform decisions, see the docs under `docs/`.

## Prerequisites

- Node.js >= 24
- pnpm 11 (the exact version is pinned via the `packageManager` field in `package.json`; install it globally with `npm install -g pnpm@<pinned-version>`. Corepack is intentionally not used.)

Install dependencies:

```sh
pnpm install
```

## Branching

- Branch from `main`.
- Naming: `feature/HD-NNN-kebab-summary`, where `HD-NNN` is the work item id.

```text
feature/HD-001-initialize-workspace
feature/HD-014-ticket-list-endpoint
```

- Keep branches short-lived: one work item per branch, merged (or discarded) quickly. Do not accumulate unrelated changes.

The remote is https://github.com/AgustinMartinezSM/helpdesk-ai. Push the feature branch and open a pull request against `main`; CI runs on every pull request and on every push to `main`, so the branch is verified on a fresh checkout before it lands.

## Commits

Conventional Commits are mandatory and enforced by commitlint via a husky `commit-msg` hook — a non-conforming message aborts the commit.

Format:

```text
<type>(<scope>): <summary>
```

Examples from this repo:

```text
feat(configuration): add zod-based environment validation library
feat(platform): implement typed bootstrap, health endpoints and hardening
chore(infrastructure): add local service composition with health checks
ci(github): add continuous integration workflow
docs(architecture): document platform foundation and initial decisions
```

Common types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `ci`.

### Pre-commit hook

The husky `pre-commit` hook runs lint-staged on staged files:

- `eslint --fix`
- `prettier` (write)

Fixes are applied to the staged files automatically. If ESLint reports unfixable errors, the commit fails; fix the code and commit again. Do not bypass hooks with `--no-verify`.

## Package management

- **pnpm only.** Do not use `npm` or `yarn` — they will produce inconsistent lockfiles and node_modules layouts.
- When adding a dependency, explain its purpose in the commit/PR description. Prefer no dependency over a trivial one.
- pnpm 11 blocks dependency lifecycle (build) scripts by default. If a new dependency needs its build script to run, add it to the `allowBuilds` allow-list in `pnpm-workspace.yaml` and state why. Currently allowed: `@parcel/watcher`, `@prisma/client`, `@prisma/engines`, `@swc/core`, `argon2`, `nx`, `prisma`, `sharp`, `unrs-resolver`.

## TypeScript project references

The workspace uses solution-style TypeScript project references. When you add, remove, or re-wire projects and the references drift, run:

```sh
pnpm nx sync
```

and commit the resulting `tsconfig` changes.

## Testing

- Write meaningful tests: assert observable behavior (schema defaults and coercion, header echo, HTTP status and body shape). Do not add `should be defined` filler tests.
- Unit tests live next to the code they test inside each library/app.
- Integration tests live next to the apps they exercise (e.g. the health endpoint tests boot a real Nest app instance with supertest).
- e2e projects are intentionally deferred for now; do not add them ad hoc.

Run tests:

```sh
pnpm test
```

## Formatting, linting, building

```sh
pnpm format        # write formatting
pnpm format:check  # verify formatting (used by CI)
pnpm lint
pnpm typecheck
pnpm build
```

CI (`.github/workflows/ci.yml`) runs `format:check`, `lint`, `typecheck`, `test` and `build` on `pnpm install --frozen-lockfile`, then provisions the service roles and test databases and runs the nine integration suites against real PostgreSQL and RabbitMQ service containers. Treat it as the definition of green: all five gate commands must pass locally before you consider a branch done, plus the integration suites for anything you touched (`pnpm infra:up` first). Green locally and green on a fresh checkout are still separate claims — CI has caught a build that only fails when the tree is cloned rather than reused.

## Adding a service

A new service has to be registered in several places that share no source, so
nothing derives one from another and a miss is usually silent rather than loud.
Work through this list and say in the PR description which entries you touched.

- **`infrastructure/postgres/init/01-service-databases.sh`** — the role plus its
  `helpdesk_<name>` and `helpdesk_<name>_test` databases. The postgres image
  runs this only on a first initialization of an empty volume, so applying a
  change locally means `pnpm infra:down`, removing the postgres data volume, and
  `pnpm infra:up` again.
- **`.github/workflows/ci.yml`, in two independent places.** The service
  containers cannot mount the init script, so the _Provision service test
  databases_ step repeats the role and `_test` database by hand; the _Integration
  tests_ step then needs its own `test-integration` line. Forgetting the first
  fails the run. Forgetting the second does not fail anything — the suite is
  simply never executed, and CI stays green while covering less than you think.
  This duplication is R10 in `docs/architecture/tenancy-migration-plan.md`.
- **`compose.yaml` and the root `.env.example`** — the
  `HELPDESK_<NAME>_DB_PASSWORD` override, in both.
- **Root `tsconfig.json`** — the project reference. `pnpm nx sync` writes it;
  commit the result.
- **`apps/<name>/src/assets/.gitkeep`** — commit it even though the directory is
  empty. The webpack config declares `assets: ['./src/assets']`, git does not
  track empty directories, and the missing file passed locally but broke
  `ai-service`'s build on a fresh CI checkout in Sprint 9.0.

## Local infrastructure

```sh
pnpm infra:up      # start postgres/redis/rabbitmq via compose
pnpm infra:status
pnpm infra:down
```

Real `.env` files are git-ignored; copy the relevant `.env.example` (per app, plus the root one for compose overrides) and adjust locally. Never commit credentials, even local ones.
