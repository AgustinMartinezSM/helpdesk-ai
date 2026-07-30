# Current handoff

**Date:** 2026-07-30
**Sprint:** 9.4 — Write paths and the first scoped reads (in progress)
**Repository:** `C:\Proyectos\helpdesk-ai`
**Branch:** `main` at `75b2bbb` — fast-forwarded from
`feat/s9-5-tenant-writes` (no merge commit, no rewritten history) and pushed.
Working tree clean, and **remote CI is green** on the first attempt.

Read `docs/progress/SPRINT-009.4.md` first, then `SPRINT-009.3.md`. This file
is the operational summary of both.

## Sprint 9.4 — writes are tenant-safe, reads are being scoped

**The plan's phase order was wrong and I inverted it.** Reads before writes
produces a broken product: reads would filter by `organization_id` while
writes still did not set it, so a ticket created in that window would carry a
null organization and its own author would not find it. Writes first has no
such state — the leak window is unchanged from today, because reads were
already unscoped.

**Every write in tickets-service and ai-service takes the organization from
the token.** `requireOrganization` is the only bridge from the actor's
optional organization to the domain's required one, so forgetting the check is
a type error rather than a row belonging to nobody.

**A child row takes its parent's tenant**, and a mutation insists the caller is
acting inside the ticket's organization rather than merely able to see it.
That discharges the debt phase 3 recorded.

**tickets-service reads are scoped.** `findById(organizationId, id)`, and
`organizationId` is required on `TicketListFilter` while every other field
stays optional — the filter builds its predicate from optional spreads, so a
forgotten field used to _widen_ the query. A foreign ticket answers null
exactly as a missing one does, so it is a 404 and not a 403: confirming
existence is the leak.

### What is left of phases 5 and 6

- **users-service directory, the audit filter, the five analytics
  aggregates** are still unscoped. R5 says the analytics five must change in
  one commit: a partial change leaves a dashboard mixing scoped and unscoped
  numbers, which is worse than either.
- **`isStaff`/`isAdmin` are still defined four times.** Delete them rather
  than change their signature, and delete the duplicate `Actor` copies in
  tickets-service and users-service in the same change or they drift.
- **Consumers still read v1**, so the rows they project carry no tenant.
- **Assignee validation** still accepts any uuid.

## Sprint 9.3 — phase 3, event contracts v2

Every domain event except `user.registered` now goes out twice: v1 unchanged,
and a v2 whose **envelope** carries `organizationId`. Nothing consumes a v2.
No queue binds one. No schema and no column changed anywhere.

**The plan's wording for this phase was wrong and cost real time.** It said
"`organizationId` required on the v2 envelope", which conflates two separate
questions — how a consumer tells old from new, and where the tenant sits.
Both are now settled and written down in the plan itself so nobody
re-litigates them from the same sentence. Version is in the contract name, as
ADR 0005 always required. The tenant is on the envelope, next to
`correlationId`, because every contract names its subject differently and the
audit trail decodes events it has no schema for.

ADR 0005 gained the envelope-evolution rule it never had: envelope fields are
added optional and never renamed or removed, and requiredness lives on the
publish path rather than on a schema that still has to accept v1.

### Three things about phase 3 that will surprise you

**There is no `user.registered.v2`, and there cannot be one.** Registration is
anonymous, and the membership that would supply a tenant is created by
_consuming_ that very event. A required field there would never be satisfied.
It stays tenant-free until organizations-service publishes membership
lifecycle events. Audit's tenant column for those rows comes from R4's
per-type map, permanently.

**A v2 is skipped, not faked, when the caller has no organization**, and the
skip is logged with the contract and subject id. This is routine, not an edge
case: resolution fails open, so a token minted during an organizations-service
outage carries no tenant. **The skip count is the metric that says whether
phase 6 can start rejecting.** Watch it.

**The audit trail now records two rows per fact.** The firehose binds `#` so
it gets both versions, and the id-keyed dedupe cannot collapse two envelopes.
This runs until phase 8 stops publishing v1. Both publishes share a
`correlationId`, which is the only thing that groups them. Anything counting
audit rows per logical fact double-counts across the window.

## Phase 4 — the columns exist and nothing reads them

Eight tables across five services gained a nullable `organization_id`, and
every row that existed was backfilled to the bootstrap organization. No domain
type, no repository mapper and no API response mentions the column.

### Three things to know before phase 5 or 7

**`user_profiles` and `user_snapshots` deliberately have no column.** They are
projected from `user.registered`, which carries no tenant and cannot — the
membership that would supply one is created by consuming that very event. They
wait for membership lifecycle events in phase 6. Do not "finish the job" by
adding the column without giving it a source first.

**Every row written between now and phase 6 has a null organization**, because
no write path sets it yet. **Phase 7 must re-run the backfill before adding
`NOT NULL`** — re-running only the verification will pass on stale data and
then the constraint will fail.

**A rebuild now leaves rows untenanted.** Replaying a projection restores its
rows but not the tenant, which is not in the source it replays from until
consumers read v2. Any rebuild has to be followed by the backfill. This is
recorded in `data-ownership.md` next to the rebuild paths themselves.

### Verification

`infrastructure/postgres/operations/verify-tenant-columns.sh`, run with
`--snapshot` before migrating and without it after. Five checks: counts
against the snapshot, no untenanted rows, every id resolves against
`helpdesk_organizations`, a ticket agrees with its comments and history, and
everything is on the bootstrap organization.

Worth knowing that its fourth check was wrong twice before it was right — a
`LEFT JOIN` reports a ticket with no comments as a disagreement, and joining
both child tables at once makes a cartesian product. What caught it was the
checks contradicting each other, not the check itself. If you extend this
script, keep the checks overlapping.

### Debt phase 3 handed to phase 4, now moved to phase 6

The organization on a ticket event is the **caller's**, not the **ticket's**.
The column now exists, so the two are separable — but nothing compares them,
because no write path sets the column. The reconciliation belongs to phase 6,
where writes take the organization from the actor's claim and a mismatch
becomes something that can be detected and refused.

## Sprint 9.2 — closed and merged

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

**The access token carries `org`, `perms` and `mv`.** tickets-service and
ai-service now read `org`; every other service still ignores all three.
`perms` is still an empty array.

## Things that will bite you if you do not know them

**Resolution fails closed now — but only on uncertainty.** This changed in
Sprint 9.4. If organizations-service cannot be asked, no token is minted and
login answers **503** (not 401 — the password was fine). If it _can_ be asked
and the answer is "this person belongs nowhere", a token is still minted with
no tenant claims, because that is the ordinary state of an account between
registering and the consumer creating its membership. That second case is
refused at the **write** instead, with a 403 that says so.

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

Seven, all applied locally and in the test databases.

organizations-service (Sprint 9.2):

- `20260730160817_init` — `organizations` and `memberships`.
- `20260730161500_bootstrap_organization` — inserts the bootstrap
  organization. `ON CONFLICT DO NOTHING`, so re-applying is safe.

Phase 4, one per service, each adding the column **and** backfilling in the
same file, every `UPDATE` scoped to `WHERE organization_id IS NULL` so
re-running is a no-op:

- `tickets-service/…_add_organization_id` — `tickets`, `ticket_comments`,
  `ticket_history`.
- `ai-service/…_add_organization_id` — `suggestions`.
- `analytics-service/…_add_organization_id` — `ticket_snapshots`.
- `notification-service/…_add_organization_id` — `ticket_refs`,
  `notifications`.
- `audit-service/…_add_organization_id` — `audit_events`.

The bootstrap organization's id is a literal in all five. It cannot be looked
up — organizations live in another database — which is why it was created as a
fixed, obviously synthetic uuid rather than a random one.

`users`, `refresh_tokens`, `user_profiles` and `user_snapshots` have no
organization column, each for its own reason: the first two are global
identity (ADR 0017, and a session belongs to a person), the last two have no
tenant source until membership events exist.

## Tests executed

Full gate, green on 2026-07-30: `format:check`, `lint` (15 projects, 0 errors,
9 pre-existing warnings), `typecheck` (14 projects — `apps/web` has none and is
covered by `next build`), `test` (15 projects), `build` (15 projects).

All nine integration suites against real PostgreSQL and RabbitMQ: messaging,
auth, tickets, users, audit, notification, analytics, ai, organizations.

Phase 3 additions, against the real broker: both versions of one fact reach a
firehose subscriber with distinct envelope ids, a shared `correlationId` and
the organization on the v2 only; a v2 is **not** routed to a queue bound to
v1, proven with a v1 sentinel as the fence rather than a timeout, and the
dead-letter queue stays empty; the audit trail records the pair as two rows.

Beyond the suites, verified by hand with both services running (Sprint 9.2):

- Register → `user.registered.v1` → membership created → login returned a
  token carrying `org`, `perms: []`, `mv: 1`; refresh carried the same.
- With organizations-service **stopped**: login and refresh both returned 200,
  tokens carried no tenant claims, and the warning appeared in the log.
- The event published during that outage was held by the durable queue and
  became a membership on restart — 13 users, 13 memberships.
- The backfill mapped 11 pre-existing users to 11 memberships (2
  `organization_admin`, 9 `requester`); a second run changed nothing, and
  there are zero duplicate `(organization_id, user_id)` pairs.

**Verified remotely too.** GitHub Actions run `30564325494` on `4cb62a2` was
green on its first attempt: lint 15, typecheck 14, test 15, build 15, and all
nine integration suites against real service containers, including
organizations-service. The provisioning step created the
`organizations_service` role and `helpdesk_organizations_test` from `ci.yml`,
which is the half of R10 that fails loudly — the other half, the
`test-integration` invocation, was confirmed by seeing the ninth suite
actually run in the log rather than by trusting the edit.

Worth knowing why that was in doubt: local green and green on a fresh clone
are separate claims, and this repository has been bitten by the difference
before (an untracked empty `src/assets` broke `ai-service:build` in CI in
Sprint 9.0 while passing locally).

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
git branch --show-current      # expect main
git log --oneline -5
git status --short             # expect clean
docker compose up -d
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Suggested continuation prompt

> Phases 3 and 4 are done and merged: `main` is at `e3ecbc5`, pushed, and
> remote CI is green. Five v2 contracts carry the organization on the envelope
> and nothing consumes them; eight tables have a backfilled `organization_id`
> and nothing reads it. Continue with phase 5, the read paths: make the
> repository
> scope a **required** argument so a missing one is a compile error, delete
> `isStaff`/`isAdmin` rather than changing their signature — including the
> duplicate `Actor` copies in tickets-service and users-service, which have to
> go in the same change or they drift — and enumerate the use cases against
> the check so `AssignTicketUseCase` is not missed, since it is the one path
> that never calls `canView`. The phase 0 isolation tests must pass at the
> end. Read the Sprint 9.3 section of this handoff first, particularly that
> rows written from now until phase 6 have a null organization, that
> `user_profiles` and `user_snapshots` have no column on purpose, and that
> membership resolution still fails open.

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
