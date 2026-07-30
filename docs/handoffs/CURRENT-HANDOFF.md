# Current handoff

**Date:** 2026-07-30
**Sprint:** 9.2 — Tenant foundation (closed)
**Repository:** `C:\Proyectos\helpdesk-ai`
**Branch:** `feat/s9-2-tenant-foundation` at `c0d24cc` plus the documentation
commit — **four commits, unmerged and unpushed.** `origin/main` is still at
`14728cd`. Working tree clean, full gate and all nine integration suites green
locally.

Read `docs/progress/SPRINT-009.2.md` first; it explains every decision below
and why each one was made. This file is the operational summary.

## Sprint 9.2 — closed

Phases 0, 1 and 2 of `docs/architecture/tenancy-migration-plan.md`.

| Commit    | Message                                                                         |
| --------- | ------------------------------------------------------------------------------- |
| `e2e37dc` | `test(tickets): assert scoped queries by row identity, not by count`            |
| `3a913f0` | `feat(observability): carry the request trace id onto published events`         |
| `0e835e0` | `feat(organizations): add organizations-service and the bootstrap organization` |
| `c0d24cc` | `feat(auth): carry the active organization in the access token`                 |

The platform behaves exactly as it did before. There is now an organization
nobody references, and three token claims nobody reads.

## What exists now that did not

**organizations-service**, port 3010, database `helpdesk_organizations`, role
`organizations_service`. Two tables: `organizations` and `memberships`. One
bootstrap organization, id `00000000-0000-4000-8000-000000000001`, slug
`bootstrap`, created by its own migration.

It consumes `user.registered.v1` on `organizations-service.user-registered`
and publishes nothing. It exposes `/health`, `/health/ready` and one internal
endpoint, `GET /internal/memberships/:userId/active`.

**It is deliberately absent from the api-gateway.** Do not add a route for it
without a reason; browsers currently have no path to it at all.

**It declares no `JWT_ACCESS_SECRET`**, unlike every other service, because it
verifies no access tokens.

**The access token carries `org`, `perms` and `mv`.** Every service receives
them and ignores them. `perms` is an empty array.

## Things that will bite you if you do not know them

**Resolution fails open.** ADR 0014 says login fails when
organizations-service is unavailable. It does not — the token is minted
without the three claims and auth-service logs
`minting a token without tenant claims: ...`. This is deliberate and
documented in ADR 0014 and the sprint report. **It must become fail-closed in
the phase where writes start setting the organization from the claim.** If you
are that phase, this is your job.

**Memberships are not a projection.** They cannot be rebuilt from the event
log. This is the first data in the platform with that property, and it is why
the consumer creates a row if absent and never overwrites one. Do not
"simplify" it into an upsert.

**Existing users are backfilled by an operator script**, not by code:
`infrastructure/postgres/operations/backfill-bootstrap-memberships.sh`. It
reads `helpdesk_auth` and writes `helpdesk_organizations`, which a migration
may do and a service may not. It is idempotent, and it is also the only
recovery path if a `user.registered.v1` is lost to a broker outage. Run it
after adding users by any route other than `POST /auth/register`.

**The role-template mapping is written twice** — in the script and in
`apps/organizations-service/src/domain/membership.ts`. If one changes, both
change, in the same commit, or a user reconciled by hand and a user projected
from an event land on different templates.

**`INTERNAL_SERVICE_TOKEN` has no default and is optional in auth-service.**
Unset means auth-service does not attempt resolution at all and mints tokens
without tenant claims. If tenant claims are unexpectedly missing, check this
first — it fails quietly by design, with one warning at bootstrap.

**Adding a service still means editing `ci.yml` twice**, in two independent
places: the role and database creation, and the `test-integration`
invocation. Forgetting the second one fails nothing — the suite simply never
runs remotely. `CONTRIBUTING.md` now carries the checklist.

## Work incomplete / deliberately deferred

- **R9's shared fixture module was not written.** Phase 0 asked for one that
  creates two organizations and scopes teardown. What exists is
  `apps/tickets-service/src/testing/fixtures.ts`, which is one service's
  fixtures and creates no organizations. There is nothing to scope teardown by
  until the tables have `organization_id`, so this belongs to the backfill
  phase — but it must exist before any suite becomes two-tenant, because every
  integration suite still calls an unfiltered `deleteMany()`.
- **`mv` is emitted and never checked.** Nothing re-validates a membership
  version. ADR 0014's re-validation idea also has an unresolved tension with
  its own rule that downstream services never call organizations-service
  synchronously. Settle that before any operation relies on `mv`.
- **The internal credential has no rotation and no audit trail.** One shared
  secret in two `.env` files. ADR 0011 named both as the story a service
  credential deserves; SECURITY.md says they are not built.
- **No organization selector and no token exchange.** Resolution picks the
  oldest active membership in an active organization. That is deterministic,
  which is what matters while there is one organization; it is not a product
  rule.
- **No membership lifecycle** — invite, activate, suspend, deactivate — and
  therefore no membership events. Both are phase 6.
- **Role templates are plain strings.** ADR 0015 wants seeded rows with
  permission mappings. Note before building them: ADR 0015 lists eight
  templates in lowercase prose and `tenancy-target-state.md` lists nine in
  another convention including a platform-scoped one, and the approved
  permission matrix uses a scope qualifier on twelve cells that has no
  representation in a flat string set. That has to be resolved before any row
  is seeded.
- The Sprint 9.0 items are unchanged: usage ceilings, key rotation and rate
  limiting still stand between the AI capabilities and `available`;
  `docs/roadmap/PRODUCT-ROADMAP.md` still does not exist and creating it is a
  product decision; the provider-notice failure path still drops the
  conservative disclosure instead of defaulting to it.

## Decisions made this sprint

- Membership resolution is a synchronous call at mint time (ADR 0014 already
  decided this); it fails open until the claims decide something.
- Existing users are reconciled by an operator script, not by an auto-
  provisioning path inside authentication.
- `perms` is emitted empty rather than filled with invented permissions.
- A session belongs to a person, not to a workspace. `refresh_tokens` gained
  no column. This closes the question ADR 0014 left open.
- The bootstrap organization is seeded by a migration, because
  `prisma migrate deploy` is the only provisioning path that runs both locally
  and in CI.
- The service credential is a dedicated secret, not `JWT_ACCESS_SECRET`, and
  it has no default.
- organizations-service is not routed by the api-gateway.

## Decisions pending

- When exactly resolution becomes fail-closed, and what login returns then.
- How `mv` re-validation works without giving downstream services a
  synchronous dependency on organizations-service.
- The role-template vocabulary and the scope-qualifier representation, before
  any template row is seeded.
- Whether to delete `feat/ai-service`, still open from Sprint 9.0.

## Migrations

Two, both in organizations-service, both applied locally and in the test
database:

- `20260730160817_init` — `organizations` and `memberships`.
- `20260730161500_bootstrap_organization` — inserts the bootstrap
  organization. `ON CONFLICT DO NOTHING`, so re-applying is safe.

No other service's schema changed. No table anywhere gained an
`organization_id` column; that is phase 4.

## Tests executed

Full gate, green on 2026-07-30: `format:check`, `lint` (15 projects, 0 errors,
9 pre-existing warnings), `typecheck` (14 projects — `apps/web` has none and is
covered by `next build`), `test` (15 projects), `build` (15 projects).

All nine integration suites against real PostgreSQL and RabbitMQ: messaging,
auth, tickets, users, audit, notification, analytics, ai, organizations.

Beyond the suites, verified by hand with both services running:

- Register → `user.registered.v1` → membership created → login returned a
  token carrying `org`, `perms: []`, `mv: 1`; refresh carried the same.
- With organizations-service **stopped**: login and refresh both returned 200,
  tokens carried no tenant claims, and the warning appeared in the log.
- The event published during that outage was held by the durable queue and
  became a membership on restart — 13 users, 13 memberships.
- The backfill mapped 11 pre-existing users to 11 memberships (2
  `organization_admin`, 9 `requester`); a second run changed nothing, and
  there are zero duplicate `(organization_id, user_id)` pairs.

**Not verified remotely.** The last remote GitHub Actions run was on
`6d2a94c`, with 14 projects and 8 integration suites. This branch is unpushed,
so the ninth suite and the fifteenth project have never run in CI. Do not
describe them as remotely green anywhere — the public engineering page was
corrected for exactly this.

## Services required to run this locally

`docker compose up -d` (PostgreSQL 5433, RabbitMQ 5672, Redis), then the
services you need. organizations-service is required only for tokens to carry
tenant claims; **login works without it**, which is the fail-open behaviour
above.

`ai-service` still needs a running `tickets-service` to read ticket context.

## Environment variable names (no values)

`apps/organizations-service/.env`: `NODE_ENV`, `PORT`, `LOG_LEVEL`,
`DATABASE_URL`, `RABBITMQ_URL`, `INTERNAL_SERVICE_TOKEN`.

`apps/auth-service/.env` gained: `ORGANIZATIONS_SERVICE_URL`,
`INTERNAL_SERVICE_TOKEN` — which must be byte-identical to
organizations-service's.

`apps/ai-service/.env` is unchanged: `NODE_ENV`, `PORT`, `LOG_LEVEL`,
`DATABASE_URL`, `RABBITMQ_URL`, `JWT_ACCESS_SECRET`, `TICKETS_SERVICE_URL`,
`AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`.

Every real `.env` is git-ignored (`.gitignore:26`) and must never be staged.

## Known risks

- **The local database was provisioned by hand.** The init script only runs on
  first initialization of an empty volume, so `organizations_service`,
  `helpdesk_organizations` and `helpdesk_organizations_test` were created with
  `psql` inside the container. The script was edited too, so a clean checkout
  is correct — but this machine's volume and the script have diverged before
  and will again. Do not delete the volume to "fix" that; it holds every local
  database.
- **The Gemini endpoint and model id still rest on a smoke test from
  2026-07-30.** Unchanged from Sprint 9.0.
- **Ticket text still leaves the machine** when `AI_PROVIDER=gemini`, and
  nothing throttles the gateway or BFF, so an authenticated staff account is
  still a spending path.
- `apps/web/next-env.d.ts` still flips between `.next/types/` and
  `.next/dev/types/` depending on whether `next dev` or `next build` ran last.
  The tracked version is the `next build` one. Do not commit the churn, and do
  not gitignore it.
- **`pnpm/action-setup@v4` targets Node.js 20**, which GitHub has deprecated.
  Still a warning, still worth its own maintenance pass rather than being
  folded into a product change.

## Resume commands

```bash
cd C:/Proyectos/helpdesk-ai
git branch --show-current      # expect feat/s9-2-tenant-foundation
git log --oneline -5
git status --short             # expect clean
docker compose up -d
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Suggested continuation prompt

> Sprint 9.2 is closed on `feat/s9-2-tenant-foundation` (four commits plus
> docs, unmerged, unpushed, tree clean, gate and all nine integration suites
> green locally). Phases 0, 1 and 2 of the tenancy migration plan are done:
> organizations-service exists on port 3010 with a bootstrap organization, and
> the access token carries `org`, `perms` and `mv` which every service
> ignores. Decide first whether to merge and push this branch, since the ninth
> integration suite and the fifteenth project have never run in CI. Then
> continue with phase 3 — versioning the event contracts so the envelope
> carries an organization — which is the ordering constraint the whole plan
> hangs off. Read the Sprint 9.2 section of this handoff first, particularly
> that membership resolution currently fails open and must not stay that way.

## Repository isolation

This project is developed in isolation: work on it touches
`C:\Proyectos\helpdesk-ai` and nothing else. No code, pattern or
configuration is carried in from another repository on this machine, and
none was during this sprint. Verify the root with
`git rev-parse --show-toplevel` before starting, and stop if it differs.

---

# Writing standard for this repository

This section is a permanent instruction, not a note about one sprint.
Later sessions should keep applying it.

The repository should read as if a person maintains it by hand, because
one does. Use a natural, direct, technically serious voice: someone who
understands the decisions being made, explains them clearly, is still
learning from the project, prefers practical language over academic
language, and documents tradeoffs honestly.

**Never fabricate** professional experience, previous employers,
customers, production incidents, team discussions, user research,
external approvals, commercial adoption, or personal anecdotes that did
not happen. The goal is an authentic project voice, not a fictional
history. Do not mention the author's age.

## Code comments

Review comments when touching a file. A comment earns its place when it
explains why a non-obvious decision exists, which invariant is protected,
why a simpler-looking alternative was rejected, which security boundary
must not be bypassed, why a compatibility layer is temporarily required,
which failure case motivated the implementation, or what must stay true
during a future refactor.

Remove or rewrite comments that are robotic, overly verbose, obvious from
the code, generic, duplicated by a type or function name, written like an
AI explanation of syntax, or no longer accurate.

Not this:

> Initialize the service dependency.
> This function returns the user.

This:

> Do not include internal notes here. Provider context is deliberately
> limited to requester-visible conversation.
> This compatibility path stays until every producer emits the v2 envelope.

Do not add informal comments to every file, and do not rewrite unrelated
comments to manufacture activity. A comment that is already accurate and
natural should be left alone.

## Markdown and architecture documentation

First-person reasoning is welcome where it adds ownership. Useful section
headings: _Why I chose this approach_, _What I considered_, _Why I did
not choose the simpler option_, _Tradeoffs_, _What is intentionally not
implemented yet_, _What I would revisit before production_, _What I
learned while implementing this_, _Current limitations_.

Good:

> I kept AI suggestions advisory because provider confidence is not a
> reliable authorization signal.

> I initially considered putting ticket text directly into RabbitMQ
> events. I rejected that for this sprint because it would duplicate
> sensitive content and create another retention boundary.

Avoid inflated language, excessive headings and lists, academic filler,
marketing language inside technical docs, "enterprise-grade" without a
concrete property behind it, "best practices" without naming which and
why, and repeated claims that the architecture is robust, scalable,
modern or production-ready.

Do not imitate a human by adding spelling errors, slang or inconsistent
formatting. Natural writing stays professional and readable.

## Documentation ownership

When a sprint changes an important decision, update the document that
owns it — the sprint report, the relevant ADR, the architecture note, the
security document, the roadmap, this handoff. Do not create another
small Markdown file that repeats what an existing one says.

Always distinguish: implemented, verified locally, API ready, deployed,
planned, intentionally deferred. **Never write that a feature is
available merely because its code exists.**

## Personal project perspective

About, Engineering, sprint retrospectives and selected decision documents
may reflect that this is a serious personal project built to learn and to
demonstrate professional software development — that the goal was not
another CRUD application, that fewer capabilities done correctly beat a
list of features that are not real, that some parts are deliberately
local or API ready until deployment is configured. Do not repeat this
context in every document, and keep operational and API documentation
objective.

## How to apply it

Progressively, inside the sprint you are working on: comments in files
you are already modifying, and the Markdown directly related to that
work. Remove clearly generated or outdated wording, preserve accurate
technical content, and do not start a repository-wide rewrite unless that
is itself an approved sprint.

End every sprint report by listing the documentation meaningfully
improved, which generated or obsolete wording was removed, and a
confirmation that no fictional experience or unsupported claim was
introduced.
