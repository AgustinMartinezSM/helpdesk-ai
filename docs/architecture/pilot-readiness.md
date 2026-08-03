# Pilot readiness — validación integral

Status: **Assessment, 2026-08-03, at `main` after Sprint 9.15.** Nothing here
is a plan that was approved; it is what I found when I went looking, with the
evidence for each item and what closing it would take. Items are ordered by
what would hurt a pilot first, not by how hard they are.

This document exists because the debt was scattered: some in the handoff, some
in sprint outcome records, some only in a comment. A reader deciding whether to
put a real organization on this needs it in one place, and needs to be able to
tell a verified finding from a remembered one.

**Nothing was deployed.** The platform runs locally against Docker Compose;
there is no hosted environment, and everything below is about what would be
true if there were one.

## 1. A projection that starts empty and has no way to catch up

**Severity: highest. Verified this session, by reproducing it.**

Every consumer declares a **durable** queue at boot
(`libs/messaging/src/lib/messaging-client.ts`, `assertQueue(..., { durable: true })`).
A durable queue survives restarts — but it does not exist before the consumer
first runs, and a topic exchange **discards** a message with no bound queue.
So a service that boots for the first time after its producers have been
working starts with an empty projection and fills only from the NEXT event.

**How I know, rather than infer.** Before Sprint 9.15 I ran a browser pass over
9.13's routing surface and found `team_refs` and `branch_refs` empty in the
tickets dev database, despite branches existing since 9.5 and a support team
since 9.12 — because tickets-service had never been started on this machine
while those events were published. Archiving and reopening the team through
the product emitted `support-team.updated.v1`, which filled the row. That is
the cold-start path working as designed, and also the proof that nothing
reconciles.

**Why it is the sharpest item.** Ticket creation validates `branchId` against
`branch_refs` and refuses an unknown one with a generic 422
(`apps/tickets-service`, Sprint 9.5 D6, fail-closed by design). A
tickets-service brought up after organizations-service has been running would
therefore **refuse every located ticket** until somebody edits each branch to
re-emit an event. The refusal is correct; the emptiness is not.

**Affected projections:** tickets-service (`branch_refs`, `station_refs`,
`team_refs`, `team_branch_refs`), users-service (`directory_memberships`),
analytics-service (`ticket_snapshots`, `user_snapshots`),
notification-service (`ticket_refs`).

**What closing it takes.** A reconciliation path per projection — either a
replay endpoint on the owning service that re-emits current state, or a
read-through fallback that asks the owner when a lookup misses. The first is
more work and keeps the hot path fast; the second is smaller and puts a
synchronous call on a path ADR 0014 deliberately kept asynchronous. It is a
sprint, not a patch, and it should be decided before a pilot rather than during
one.

**It does not block CSV import, and I checked rather than assumed.**
`ImportPeopleUseCase` resolves branches and departments through
`BranchRepository` and `DepartmentRepository`, whose Prisma implementations
read `prisma.branch` and `prisma.department` — organizations-service's **own
tables**, which are the source of truth rather than a copy of one. The import
reads no projection anywhere.

## 2. Nothing limits how much a caller can ask for

**Severity: high. Carried from Sprint 9.0, still true, and 9.15 widened the
surface.**

There is no rate limiting anywhere in the platform, and no usage ceiling on the
AI endpoints — the Sprint 9.0 outcome record named all three (ceilings, key
rotation, rate limiting) as the work that would earn the AI feature the
`available` status it does not have.

Sprint 9.15 added a synchronous endpoint that accepts up to 500 rows and does
per-row database work. It is bounded (500 rows, 64 000 characters, both refused
above) and it needs `people.import`, which only owner and organization_admin
hold — so it is not an anonymous amplification surface. It is still the largest
unit of work a single authenticated request can ask for, and a pilot with a
shared database should know that before somebody discovers it.

## 3. Service-to-service calls are authenticated but not attributed

**Severity: medium. Carried, and narrower than it was.**

`INTERNAL_SERVICE_TOKEN` guards no mutation anywhere since Sprint 9.11 — what
remains behind it is two read-only membership lookups. So an unattributed call
can no longer change anything, which is why this is medium rather than high.
What is still missing is knowing WHICH process called: the credential is shared,
and a self-declared caller header would log a claim the credential does not
bind. Closing it means per-caller secrets or a signed service assertion.

The credential is rotatable (`INTERNAL_SERVICE_TOKEN_PREVIOUS`, runbook in
SECURITY.md) and the gateway strips the header from every inbound request.

**One hole in the testing of it, worth stating:** CI's workflow env block sets
only `DATABASE_URL`, so `INTERNAL_SERVICE_TOKEN` is never exercised across a
real process boundary by any suite. The rotation logic is unit-tested against
both values; the cross-process hop is not covered.

## 4. A stale token outlives the decision that should have ended it

**Severity: medium, and deliberate. Carried.**

`mv` (membership version) is minted and bumped and **nothing compares it**
(narrowed on purpose in ADR 0014's amendment to "a cheap staleness signal").
An access token lives `JWT_ACCESS_TTL_SECONDS` — 900 by default — so somebody
suspended, demoted, removed from a support team or moved between branches keeps
the old answer for up to fifteen minutes.

Every administration path already compensates where it matters by reading the
**stored** membership rather than the token (ADR 0021, and again in 9.14's
grantable-templates endpoint and 9.15's import). What remains exposed is
READ visibility: the `br` and `tm` claims are snapshots, so team and branch
scope shrink at the next mint rather than immediately. The sprint documents say
so rather than implying it is instant, and the product copy does too.

A pilot should decide whether fifteen minutes is acceptable for a suspension.
If it is not, the options are a shorter TTL (cheap, more refresh traffic) or
comparing `mv` at the guard (correct, and a synchronous lookup on every
request unless cached).

## 5. Test-fixture isolation is incomplete

**Severity: medium for the test suite, none for production. Carried (R9).**

Sprint 9.8 built a scoped two-organization fixture for organizations-service
only — its invitations table cascades, so teardown order became load-bearing.
The other eight suites still tear down with unfiltered `deleteMany()`. That is
fine while suites run sequentially and alone, and it is exactly the thing that
breaks the day two suites share a database or run in parallel.

Sprint 9.15 added a fifth file to the organizations fixture's care
(`people-import.int.spec.ts`) and used the scoped fixture, so it did not make
this worse.

## 6. Smaller things, each verified

- **`apps/web/specs` is type-checked by nothing.** `apps/web/tsconfig.json`
  includes `src/**` only; the specs are transpiled by SWC, so a type error
  there surfaces as a runtime failure instead of a build one. Verified by
  reading the include list. Sprints 9.9, 9.13, 9.14 and 9.15 have all added
  files to that pile.
- **`refreshRequest` has no timeout.** `apps/web/src/lib/session.ts` calls
  `fetch` with no `AbortSignal`, so with the BFF down the mount-time refresh
  never settles and every authenticated route sits on its loading state
  forever rather than falling back to signed-out. Verified by reading.
- **A member who never had an invitation is invisible to the import's
  idempotency check.** New in 9.15 and documented in its outcome record: the
  check reads the invitation table, so the first administrator (made in SQL)
  or a legacy backfilled user would be issued a code by an import. Redeeming
  it is harmless — the membership insert skips duplicates and leaves their
  role alone — which is why it is listed here rather than fixed.
- **The organization's own name and slug cannot be changed from inside the
  product.** The slug is what the bootstrap lookup keys on, so its immutability
  is its own decision; the name is a small endpoint nobody has needed.
- **No transfer of ownership.** `owner` can be neither granted nor targeted, so
  an organization whose only privileged member is its owner cannot change that
  from inside.
- **The first administrator of a fresh database has to be made in SQL.** The
  intended consequence of deleting the unattributable operator endpoint in
  9.10, and a real step in any deployment runbook.
- **The AI provider notice has no failure path.** If `GET /ai/provider` fails,
  the panel shows an error and no provider notice at all, quietly dropping the
  "No language model is connected" disclosure instead of defaulting to the
  conservative message. Found in 9.0, still open.

## What I did NOT check

Naming these matters more than the list above, because an assessment that does
not say where it stopped reads as more complete than it is.

- **No load, soak or concurrency testing** beyond the single-use invitation
  race the invitations integration suite exercises. Nobody has run this with
  hundreds of concurrent users, and the 500-row import has never been run at
  500 rows against a real database.
- **No security review by anyone but me**, and no dependency audit in this
  pass.
- **No backup or restore procedure**, because there is no hosted database to
  back up. The migration story is forward-only and documented; the recovery
  story does not exist.
- **No observability beyond structured logs and correlation ids.** There are no
  metrics, no dashboards, no alerts, so most of the items above would be
  discovered by a person noticing rather than by a signal.
- **Browser coverage is Chromium through the preview tool only.** No other
  engine, no mobile browser, no assistive-technology pass beyond the semantics
  the specs assert.

## What is genuinely solid

Worth stating, because a readiness document that only lists problems
misrepresents the thing it is assessing.

Tenant isolation is enforced in the database (`NOT NULL` on seven tables since
phase 7), at every repository port, and ahead of every permission check — a bug
in permission evaluation can produce an over-broad in-tenant read and not a
cross-tenant one. Authorization is permission-based end to end with one
vocabulary shared by services and browser (9.14). Every grant path reads one
derivation, so privilege cannot escalate through invitation, role change or
import. Refusals are deliberately blind where telling them apart would leak
existence. The full gate plus nine integration suites against real PostgreSQL
and RabbitMQ has been green on every sprint since the tenancy migration, and
each sprint records its own remote CI run.
