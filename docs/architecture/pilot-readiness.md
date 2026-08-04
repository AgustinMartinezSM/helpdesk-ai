# Pilot readiness — validación integral

Status: **Assessment, 2026-08-03, at `main` after Sprint 9.15, amended after
Sprint 9.16.** Nothing here is a plan that was approved; it is what I found when
I went looking, with the evidence for each item and what closing it would take.
Items are ordered by what would hurt a pilot first, not by how hard they are.

Item 1 was the reason Sprint 9.16 happened, and it is now **partly resolved** —
the verified defect is fixed, the class of problem is not. The numbering is kept
so the record of what was found stays readable; the item says exactly which half
closed and how it was proven.

This document exists because the debt was scattered: some in the handoff, some
in sprint outcome records, some only in a comment. A reader deciding whether to
put a real organization on this needs it in one place, and needs to be able to
tell a verified finding from a remembered one.

**Nothing was deployed.** The platform runs locally against Docker Compose;
there is no hosted environment, and everything below is about what would be
true if there were one.

## 1. A projection that starts empty and has no way to catch up

**Severity: was highest. RESOLVED for tickets-service in Sprint 9.16; still
open for four other projections (see "What Sprint 9.16 did not close" below).**
The finding is kept as it was written, because what closed it only makes sense
against what was found.

### The finding, as it stood after Sprint 9.15

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

**What closing it takes** (written before Sprint 9.16, and worth keeping
because the estimate was half right). A reconciliation path per projection —
either a replay endpoint on the owning service that re-emits current state, or a
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

### What closed it, for tickets-service (Sprint 9.16)

Neither of the two options above was taken. A **snapshot pulled from the owner**
was: organizations-service offers three read-only, keyset-paginated endpoints
under `/internal/structure/*` (branches, stations, teams with their branch scope
inline), and tickets-service walks them at boot — after its subscription is
live — and on demand. No service reads another's database; the hot path is
unchanged, so 9.5's D4 stands. ADR 0003 and ADR 0005 carry the amendments; the
operator procedure is `docs/architecture/projection-reconciliation.md`.

The ordering is the safety argument and it needed no new mechanism: `subscribe()`
resolves only after the queue is bound, and every apply is last-write-wins on the
source's own timestamp, so an update landing mid-walk wins rather than being
overwritten by an older snapshot row. Reversing the two calls reopens the window.

**The proof is a real broker and a real database, not mocks, and it is the part
of this that matters.** `apps/tickets-service/src/app/messaging/projection-cold-start.int.spec.ts`
deletes the durable queue so the start is genuine, publishes branch and team
events against real RabbitMQ with nothing bound, and then **asserts the
projection in real PostgreSQL is still empty** — which is what proves the events
were discarded rather than merely delayed, and it is the one step that cannot be
faked with a stub. It then shows a located ticket refused, reconciles, and shows
the same ticket accepted and routed to both an organization-wide and a
branch-scoped team. It also covers an event arriving after the rebuild, an older
snapshot row failing to overwrite a newer event, and a dry run writing nothing.
Reproducing the defect first is what makes the fix a fix rather than a claim.

The reproduction that opened this item — `team_refs` and `branch_refs` empty in
the tickets dev database — is now repaired by a boot rather than by editing a
branch to make it re-emit.

### What Sprint 9.16 did not close

Four projections still have the same exposure and no equivalent path:
users-service's `directory_memberships`, analytics-service's `ticket_snapshots`
and `user_snapshots`, and notification-service's `ticket_refs`. Their documented
rebuild paths in `docs/architecture/data-ownership.md` are HTTP refetches with
known gaps (auth-service exposes no user listing; a rebuild must still be
followed by the tenant backfill), not a reconciliation. Their consequences are
milder than the one above — a stale directory or a missing analytics row does not
refuse anybody's ticket — which is why this drops from "highest" rather than
disappearing.

Two smaller residuals, stated so nobody assumes otherwise: **nothing schedules
the check** (there is no scheduler anywhere in this repository — it runs at boot
and when an operator asks), and **drift produces a log line and an HTTP response,
not a metric or an alert**, so it is found by somebody looking. Both are
instances of the observability gap this document names at the end.

Departments are not in that list and never will be: they publish no contract, so
there is nothing to project or reconcile (ADR 0022's Sprint 9.16 amendment).

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

**Severity: medium. Carried, and the surface behind the credential grew in
Sprint 9.16 — read this rather than the older one-line version of it.**

From Sprint 9.11 until 9.16 the accurate statement was that
`INTERNAL_SERVICE_TOKEN` guarded no mutation anywhere: what sat behind it was
two read-only membership lookups. **That sentence is no longer literally true**,
and the difference is worth stating rather than leaving somebody to find it.
Sprint 9.16 added three read-only snapshot endpoints on organizations-service
and, on tickets-service, an on-demand reconcile that **writes** — so the
credential now opens one write path.

What it writes is the distinction. Reconciliation touches projection rows only:
it can create no ticket, no membership and no domain entity, it can delete
nothing, and every row it writes is one the event stream would have written
anyway. The endpoints 9.10 and 9.11 deleted were different in kind — they
changed domain state on behalf of a person with nobody attached, so "who decided
this" had a subject and no answer. Here that question has no subject: the walk
expresses no human decision. The justification is written in the controller
rather than assumed, and it is why this stays medium.

What is still missing is unchanged and is the actual finding: knowing WHICH
process called. The credential is shared, and a self-declared caller header
would log a claim the credential does not bind. Closing it means per-caller
secrets or a signed service assertion.

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

Sprint 9.16 did add to the pile, and it should be said plainly:
`projection-cold-start.int.spec.ts` tears down the four structure projections
and `tickets` with unfiltered `deleteMany()`, because tickets-service has no
scoped fixture to use. It is the same debt, one file larger. That suite also
deletes and re-declares its own durable queue, which is deliberate — it is how
the cold start is made genuine — and it is a second reason not to run these
suites in parallel against one broker.

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
  check reads the invitation table, so the first administrator (who since
  Sprint 10.4 creates the organization rather than being made in SQL, and so
  still holds no invitation)
  or a legacy backfilled user would be issued a code by an import. Redeeming
  it is harmless — the membership insert skips duplicates and leaves their
  role alone — which is why it is listed here rather than fixed.
- ~~**The organization's own name and slug cannot be changed from inside the
  product.**~~ **Half closed in Sprint 10.5** (ADR 0024): the display name can
  be changed by anybody holding `organization.update`. The **slug still
  cannot**, and that half is a decision rather than a gap — it is what the
  bootstrap lookup keys on, what `prisma migrate deploy` collides with, and
  what ADR 0023 derived silently so a collision could never be reported across
  tenants. Editing it by hand would need a redirect story and a uniqueness
  answer that does not leak, and nothing needs it yet.
- ~~**No transfer of ownership.**~~ **Closed in Sprint 10.5** (ADR 0024): the
  current owner can hand the organization to any active member, in one
  transaction, and becomes an `organization_admin` rather than being removed.
  `owner` is still neither grantable nor targetable — the transfer is not a
  grant path and does not go through the derivation — and a partial unique
  index makes two owners unrepresentable. What is still open is narrow and
  listed with ADR 0023's remainder below: there is no way to hand an
  organization to somebody who is not a member yet, because inviting them first
  is the whole mechanism.
- ~~**The first administrator of a fresh database has to be made in SQL.**~~
  **Closed in Sprint 10.4** (ADR 0023): an authenticated person who belongs to
  no real organization can create one and becomes its owner, in one
  transaction, over an attributable route. The 9.10 deletion that caused this
  stands — nothing unattributable came back. What remains of the gap is
  narrower and is recorded in the ADR: somebody who already belongs to a real
  organization still cannot create a second one, because there is no
  organization selector to reach it with. **That remainder closed in Sprint
  10.6** (ADR 0025): the selector exists, the refusal is gone, and the create
  flow switches into what it made.
- **`analytics-service` counts a person in ONE organization, and it is already
  the wrong one.** `user_snapshots` is keyed on `userId` alone, so a person
  active in two organizations gets one row — and because the bootstrap
  membership claims it first, every real organization already counts
  approximately nobody. Predates Sprint 10.6 and was not caused by it; that
  sprint makes it easier to notice rather than worse. Closing it needs a
  migration, a backfill, and a correction to an in-memory double that currently
  disagrees with Prisma about the behaviour being changed, so unit and
  integration suites would not agree about the fix.
- **`INTERNAL_SERVICE_TOKEN` is still optional in auth-service**, and its own
  env comment says it should become required "in the phase that makes the
  claims decide something". Sprint 10.6 was that phase and deliberately did not
  flip it: the auth integration suite runs without organizations-service, so
  flipping the schema turns every login in that suite into a 503. The order is
  to teach the suite to override the resolver at the boundary first — the
  pattern already exists there for the throttler guard — in a sprint that owns
  the suite change.
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
phase 7), and every read that addresses a ticket takes the organization from the
token before it addresses the row — so a bug in permission evaluation can produce
an over-broad in-tenant read and not a cross-tenant one.

**One correction, found during Sprint 10.0 while checking this paragraph rather
than quoting it.** It used to say "at every repository port, and ahead of every
permission check", and neither half survives the check it invites.
`TicketRepository.commentsFor` and `historyFor` take no organization —
they reach a ticket already located by `findById`, which is scoped, so the
property holds transitively rather than at the port. And several use cases
evaluate the permission before `requireOrganization` rather than after. The
guarantee above is the one that is true and is the one that matters; the
stronger wording was an overstatement in a document whose value is that it
does not overstate. Authorization is permission-based end to end with one
vocabulary shared by services and browser (9.14). Every grant path reads one
derivation, so privilege cannot escalate through invitation, role change or
import. Refusals are deliberately blind where telling them apart would leak
existence. The full gate plus nine integration suites against real PostgreSQL
and RabbitMQ has been green on every sprint since the tenancy migration, and
each sprint records its own remote CI run.
