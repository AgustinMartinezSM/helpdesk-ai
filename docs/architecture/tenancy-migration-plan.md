# Tenancy migration — risk register and phased plan

Status: **Approved 2026-07-30.** Phases map to sprints 9.2–9.4 in the
delivery plan; the threat ids are from `tenancy-threat-model.md`. Phases 0, 1
and 2 ran in Sprint 9.2, phases 3 and 4 in Sprint 9.3, and phases 5 and 6 in
Sprint 9.4 — in inverted order: phase 6's write half first, then phase 5's
reads, then phase 6's consumers and lifecycle (see phase 5 for why). Each
entry records its own deviations. Phases 7 and 8 were approved and executed
on 2026-07-31 — **the migration is complete**. Phase 7's evidence and outcome
live in `tenancy-phase-7-readiness.md`.

## The ordering constraint that drives everything

**Messaging contracts must be versioned before the event-fed services can
become tenant-aware.** audit-service, notification-service and
analytics-service learn everything they know from the bus, and the envelope
has no tenant field. Until it does, those three services have nothing to
scope by — no amount of work inside them helps.

That is why phase 3 (contracts) sits before phase 5 (consumers), and why
attempting them together produces a half-migrated bus.

## Risk register

Severity: how bad if it happens. Likelihood: how likely given the current
code. Both are my judgement, not measurements. Risk and evidence describe the
code as it stood at approval; where a mitigation has landed the mitigation
cell says so and names the commit.

| #   | Risk                                                                                                                                                                                     | Evidence                                                                             |   Sev    |   Lik    | Services                       | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Sprint | Rollback concern                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | :------: | :------: | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----: | --------------------------------------------------------- |
| R1  | **Optional scope field silently widens every query.** `organizationId?` type-checks everywhere and defaults to cross-tenant.                                                             | `prisma-ticket.repository.ts:56` optional spread; audit's filter is all-optional too | **High** | **High** | tickets, audit, analytics, ai  | Scope is a **required** field. Missing scope must be a compile error. Add a test asserting the query is scoped, not just that counts match. **Done everywhere (`e6e1818`, `67f1906`, `078da2d`, `8f04f02`)** — every organization-owned read takes a required scope.                                                                                                                                                                                                                                |  9.3   | None — caught at compile time if done right               |
| R2  | **Test suite stays green through a cross-tenant leak.** The one tickets integration spec asserts `total`, never that a foreign row is absent from `items`.                               | `prisma-ticket.repository.int.spec.ts:76`                                            | **High** | **High** | tickets                        | Write the two-organization isolation test **first**, before any column exists, and watch it fail. **Done (`e2e37dc`, `e6e1818`)** — tickets asserts row identity, and the two-organization test plants a foreign row with the SAME requester so only the organization can be filtering.                                                                                                                                                                                                             |  9.2   | None                                                      |
| R3  | **`AssignTicketUseCase` is missed.** It never calls `canView`, so an org check added inside `canView` does not reach it.                                                                 | `use-cases/ticket-lifecycle.ts:79`                                                   | **High** | **High** | tickets                        | Enumerate use cases against the check, not the other way round. Add the assignee membership check at the same time. **Done (`3968b7f`)** — assignment verifies the assignee against live membership, fail-closed.                                                                                                                                                                                                                                                                                   |  9.3   | None                                                      |
| R4  | **audit_events backfill is not uniformly derivable.** Tenant identity lives inside opaque jsonb, and each contract names its subject differently (`ticketId`, `userId`, `suggestionId`). | `audit-service/prisma/schema.prisma:19`; contracts.ts                                | **High** |  Medium  | audit                          | Backfill per event type with an explicit map; anything unmatched gets the bootstrap organization and is **logged**, not guessed silently. **Two rows per fact since phase 3** (`45b1b88`) — the map must key on `type`. **Partly discharged (`67f1906`)**: the consumer now persists the envelope tenant, so the map is only ever needed for rows that predate it — all bootstrap-owned while one organization exists, which is why `backfill-tenant-columns.sh` refuses to run once there are two. |  9.4   | Backfill is additive; the column can be dropped           |
| R5  | **analytics has no signature to thread a tenant into.** `total()`, `countByStatus()`, `countByPriority()` take zero arguments.                                                           | `prisma-analytics.repository.ts:60`                                                  | **High** |  Medium  | analytics                      | Change all five signatures in one commit. Partial change leaves a dashboard mixing scoped and unscoped numbers — worse than either. **Done (`078da2d`)**, one commit.                                                                                                                                                                                                                                                                                                                               |  9.4   | Revert is a single commit                                 |
| R6  | **`isStaff` drifts across four definitions.** Updating `libs/security` misses tickets-service and users-service.                                                                         | `actor.ts:13`, `ticket.ts:70`, `user-profile.ts:35`, `[id]/page.tsx:81`              | **High** |  Medium  | tickets, users, web            | **Delete** `isStaff`/`isAdmin` rather than change their signature, so every duplicate becomes a compile error. **Done (`a0aa60f`)** — zero definitions remain outside apps/web's independent client-side boolean.                                                                                                                                                                                                                                                                                   |  9.3   | None                                                      |
| R7  | **Stale membership claims after suspension**, ceiling one access-token TTL (900s).                                                                                                       | `env.ts:28-33`; `refresh-session.ts:44`                                              |  Medium  |   High   | auth, all                      | Accept bounded staleness; re-validate for high-consequence operations only (ADR 0014). **Done in shape (`4e68f93`, `3968b7f`)**: refresh re-resolves, transitions bump the version, and assignment asks live rather than comparing `mv`.                                                                                                                                                                                                                                                            |  9.4   | n/a                                                       |
| R8  | **Global email unique blocks nothing now but constrains forever.** Two constraints, in two databases, that must change together.                                                         | `users_email_key`, `user_profiles_email_key`                                         |  Medium  |   Low    | auth, users                    | Keep both global; express multi-org via membership (ADR 0017). Revisit only if email becomes optional.                                                                                                                                                                                                                                                                                                                                                                                              |   —    | Changing later means a coordinated two-database migration |
| R9  | **Fixtures truncate.** Every integration suite calls unfiltered `deleteMany()`, so a two-tenant test deletes the other tenant's rows.                                                    | every `*.int.spec.ts`                                                                |  Medium  |   High   | all                            | Introduce a shared fixture module that creates two organizations and scopes teardown. **Partially paid in Sprint 9.8, for organizations-service only** (`src/infrastructure/testing/organization-fixture.ts`): the invitations table cascades from organizations, so teardown ORDER became load-bearing there first, and the invitation suite needs two real tenants. The other eight suites still call unfiltered `deleteMany()`; the repo-wide module is still owed.                              |  9.3   | None                                                      |
| R10 | **CI provisioning duplicates the init script by hand.** A new database or role must be added in two places with no shared source.                                                        | `ci.yml:77`; `01-service-databases.sh`                                               |  Medium  |  Medium  | CI                             | Adding organizations-service means editing both. Note it in the PR checklist; consider generating one from the other. **Done by hand (`0e835e0`)** — the init script and two separate spots in `ci.yml`; still no shared source.                                                                                                                                                                                                                                                                    |  9.2   | CI-only                                                   |
| R11 | **The gateway forwards every header untouched**, so any header-based tenancy is forgeable.                                                                                               | `service-proxy.ts:29`                                                                | **High** |   Low    | gateway                        | Tenancy lives only in the signed token. Never introduce a trusted tenant header without first giving the gateway a strip-and-reinject step. **The strip half exists since Sprint 9.8**: the proxy drops `x-internal-service-token` on every route, because organizations-service — the one host with a process-authenticated surface — became routable (ADR 0019). The rule itself stands: nothing else is stripped, so no other header may be trusted.                                             |  9.2   | n/a — a rule, not a change                                |
| R12 | **CORS and the refresh cookie collide with per-tenant hosts.** Exact-match origins, no wildcard; cookie hard-coded to path `/session`.                                                   | `env.ts:34`; `session.controller.ts:144`                                             |  Medium  |   Low    | web-bff                        | Keep one host; select organization in-app rather than by subdomain. Revisit only if per-tenant hosts become a requirement.                                                                                                                                                                                                                                                                                                                                                                          |   —    | Changing later invalidates live sessions                  |
| R13 | **A rebuild path becomes a cross-tenant operation.** Every documented projection rebuild is a global staff read.                                                                         | `data-ownership.md:58-65`                                                            |  Medium  |  Medium  | users, notification, analytics | Scope rebuild procedures per organization and update the doc in the same change. **Done (phase 8)** — the scoped reads made every documented rebuild per-organization by construction; data-ownership.md records the two residual GAPs (registrations listing, user_snapshots re-stamp).                                                                                                                                                                                                            |  9.4   | Rebuilds are already destructive-then-replay; unchanged   |
| R14 | **No role-changed event exists**, so users-service's projected `roles` cannot be kept fresh.                                                                                             | contracts.ts — only `user.registered.v1`                                             |   Low    |  Medium  | users                          | Membership events from organizations-service supersede this. Do not add a role-changed event to auth-service. **The events exist now (`4e68f93`)**; the projected `roles` column itself is phase-8 cleanup.                                                                                                                                                                                                                                                                                         |  9.4   | None                                                      |
| R15 | **`correlationId` is never set**, so an audit row cannot be traced to a request or an actor.                                                                                             | all three publishers pass two args                                                   |   Low    |   High   | all                            | Pass it. Cheap, independent of tenancy, and it makes every later investigation possible. **Done (`3a913f0`)** — all three publishers stamp the request trace id on the envelope.                                                                                                                                                                                                                                                                                                                    |  9.2   | None                                                      |

## Phased plan

Each phase ends in a state that can be deployed and reverted. No phase leaves
a required column half-populated.

### Phase 0 — Prove the leak first (Sprint 9.2) — **done, partly**

Shipped as `e2e37dc` (the tickets assertions) and `3a913f0` (`correlationId`).
The shared fixture module was not delivered; see below.

Before any schema change: write the two-organization isolation tests and
**watch them fail**. R2 says the current suite cannot detect the failure mode
this migration risks; the only way to trust the tests later is to see them red
first.

Also here, because they are independent and cheap: pass `correlationId` in the
three publishers (R15), and write the shared fixture module (R9).

**Checkpoint:** tests exist and fail. Nothing else has changed. Revert = delete
tests.

**What actually landed.** The tickets suite asserts by row identity rather than
by `total`, which is as far as the intent reaches while no `organization_id`
column exists: the scope those tests prove is the requester, not the
organization, and they are green rather than red, because requester scoping
already works. The two-organization version of them — the one that has to be
watched failing — belongs to phase 5, where the read paths first take a scope.

**Outstanding: the shared fixture module (R9).**
`apps/tickets-service/src/testing/fixtures.ts` is one service's builders, used
by one suite, and it creates no organizations; every integration suite still
calls unfiltered `deleteMany()`. That is not a shortcut — there is nothing to
scope teardown by until the tables carry `organization_id`, which is phase 4.
R9 moves there.

**Update (Sprint 9.8):** organizations-service now has a scoped fixture of its
own (`src/infrastructure/testing/organization-fixture.ts`) because its
invitation suite genuinely needs two live tenants, and because `invitations`
cascades from `organizations` — the first place in that service where teardown
order decides whether a suite passes. It deletes only the rows its own
fixtures created, in dependency order rather than by relying on the cascade,
and leaves the bootstrap organization alone (it comes from a migration
`migrate deploy` will not re-run). This is one service's answer, not the
module: the other eight suites are unchanged and R9 stays open.

### Phase 1 — organizations-service and the bootstrap organization (9.2) — **done**

Shipped as `0e835e0`.

Create the service, `helpdesk_organizations`, its role, its CI provisioning
(both places — R10), and one **bootstrap organization** that every existing
row will belong to. Memberships for all existing users. No other service
changes.

Memberships for users who registered before the service existed come from an
operator script,
`infrastructure/postgres/operations/backfill-bootstrap-memberships.sh`: their
rows live in `helpdesk_auth`, ADR 0003 forbids a service reading another
service's database, and auth-service exposes no user listing. It is idempotent,
and it is also the recovery path for a registration event lost to a broker
outage — memberships, unlike every other store here, cannot be rebuilt from the
event log.

**Checkpoint:** the platform runs exactly as before, with an organization
nobody references yet. Revert = drop the database, remove the service.

### Phase 2 — tenant context in the token (9.2) — **done, checkpoint not met**

Shipped as `c0d24cc`.

`org`, `perms`, `mv` claims; `Actor` gains `organizationId` and
`permissions`; auth-service resolves membership at mint time. Downstream
services receive the claim and **ignore it**.

**Checkpoint:** every token carries an organization; no behaviour depends on
it. Revert = stop emitting claims; tokens remain valid.

**Deviation: not every token carries an organization.** Resolution fails open.
If organizations-service is unavailable, or `INTERNAL_SERVICE_TOKEN` is unset,
the token is minted without the three claims and a warning is logged; a user
with no membership also gets none, since the claims are omitted rather than
sent as null. The honest statement of the checkpoint is "a token carries an
organization when one resolves". Failing closed is right once the claims decide
something (ADR 0014) and wrong today, when they decide nothing and a new
service nobody depends on would become a single point of failure for every
login. Making it fatal belongs to the enforcement phases, and that logged
warning is the signal to watch before then.

Two smaller gaps in the same direction. `perms` is currently always an empty
array: role templates are still plain strings and the evaluator arrives later
in this plan. And the fields are **optional** on `Actor` and
`AccessTokenPayload` — making them required is what turns every authorization
call site into a compile error, but that only works once the duplicate local
`Actor` copies in tickets-service and users-service are deleted, which is phase
5 (R6).

### Phase 3 — event contracts v2 (9.3) — **done, with deviations**

Shipped as `45b1b88`.

`organizationId` required on the v2 envelope. Publish **both** v1 and v2
during the compatibility window (ADR 0005 forbids mutating a contract in
place). Consumers keep reading v1.

**Checkpoint:** both versions on the bus, nothing consuming v2 yet. Revert =
stop publishing v2.

**What "the v2 envelope" was taken to mean.** That sentence conflates two
independent decisions — how a contract is versioned, and where the tenant sits
— and on its own it reads like mutating the shared envelope in place. Three
other sentences in this plan rule that reading out: the checkpoint wants both
versions on the bus, consumers keep reading v1, and phase 8 stops publishing v1
once every consumer reads v2. None of those means anything unless the two
streams are separately addressable. So the version stays in the type string, as
ADR 0005 requires: five new contracts, `ticket.created.v2`,
`ticket.status-changed.v2`, `ticket.assigned.v2`, `ticket.comment-added.v2` and
`ai.suggestion.created.v2`. The routing key is the type verbatim, and `.` is the
word separator in a topic exchange, so `ticket.created.v1` does not match
`ticket.created.v2`. Each v2 shares the v1 payload schema object rather than
restating it, so the payloads are identical by construction and not by
discipline; a test asserts the two contracts point at the same object.

**The tenant is on the envelope, not in the payloads.** Every contract names its
subject differently (`ticketId`, `userId`, `suggestionId`), and audit-service
decodes events it holds no schema for — a payload field would be invisible to
exactly the consumer that needs it most, which is the same shape of problem R4
records about backfilling `audit_events`. On the envelope it sits in one place
for every contract, and the firehose reads it without knowing any of them. It
also had to go on `eventEnvelopeSchema` itself: zod strips unknown keys, so an
unmodelled field would be dropped silently at every consumer. `PublishOptions`
carries it and `buildEnvelope` spreads it conditionally, exactly as
`correlationId` does — absent rather than `undefined` when there is none.

**Deviation: there is no `user.registered.v2`, and there cannot be one.**
Registration is anonymous, and the membership that would supply a tenant is
created by consuming that very event — organizations-service looks the bootstrap
slug up on the consumer side. A required tenant there is structurally
unsatisfiable, not merely awkward. What replaces it is the membership lifecycle
events organizations-service owns, which phase 6 adds.

**Deviation: "required" holds on the publish path, not on the shared schema.**
The field is optional on `eventEnvelopeSchema` and on `EventEnvelope`, next to
`correlationId`, and `buildEnvelope` validates payloads and never envelopes, so
nothing in `libs/messaging` enforces it. The guard is explicit at each
publishing adapter: v1 goes out unconditionally and unchanged, v2 only when the
caller organization is known; otherwise the adapter logs a warning naming the
contract and the subject id, and skips the v2. That follows from phase 2 failing
open — a token minted during an organizations-service outage carries no tenant,
and neither does one for a user whose membership has not been backfilled.
Publishing a tenant-free v2 would put on the bus exactly the message phase 6 is
meant to reject. The two publishes are independent best-effort calls carrying
the same `correlationId`; one failing does not suppress the other.

**Consequence: audit-service now records two rows per logical fact.** No
consumer changed — the nine binding keys across users-, organizations-,
notification- and analytics-service are exact literals with no wildcards, so
they receive nothing new. The one wildcard binding in the repository is
`audit-service.event-log` on `#`, and it receives both versions. For the whole
compatibility window — this phase until phase 8 stops publishing v1 — the audit
trail holds two rows for every fact. The id-keyed dedupe cannot collapse them:
they are two envelopes with two ids. They are told apart by the `type` column
and related only by the shared `correlationId`, so anything counting audit rows
per logical fact double-counts across the window. An integration test pins this
as intended behaviour. The checkpoint's "nothing consuming v2" holds only in the
sense that nothing reads the tenant yet; the firehose already receives it, and
phase 4's backfill (R4) meets those doubled rows.

**Debt for phase 4: the organization on a ticket event is the caller's, not the
ticket's.** A ticket carries no organization column until phase 4, so there is
nothing else to read from. The two cannot differ today, because a caller only
reaches tickets they may already see, but nothing enforces that. Phase 4 has to
reconcile them once the column exists.

Verified: `libs/messaging` gained 39 unit and 5 integration tests, new adapter
specs in tickets-service and ai-service pin the dual publish and the
skip-and-warn, and the full gate is green — locally and on a remote runner,
green on the first attempt.

### Phase 4 — nullable columns and backfill (9.3) — **done, with deviations**

Shipped as `19909ae`.

Add `organization_id` nullable to all ten organization-owned tables. Backfill
every existing row to the bootstrap organization. audit_events per event type
with an explicit map and logged misses (R4).

**Verify before proceeding:** row counts per table before and after are
identical; zero nulls remain; no row references an organization that does not
exist; spot-check that ticket → comments → history all agree on the
organization.

**Checkpoint:** columns exist and are fully populated but nothing reads them.
Revert = drop the columns.

**Eight tables, not ten.** `tickets`, `ticket_comments`, `ticket_history`,
`suggestions`, `ticket_snapshots`, `ticket_refs`, `notifications` and
`audit_events` got the column. `user_profiles` and `user_snapshots` did not.

Both are projected from `user.registered`, which phase 3 established has no
v2 and cannot have one: the membership that would supply a tenant is created
by consuming that very event. So the column would have had no source, and the
choice was between hardcoding the bootstrap organization inside two consumers
or letting new rows accumulate nulls with no date on which anything fills
them. They wait for the membership lifecycle events in phase 6, which are
their only honest source. Both are rebuildable projections, so arriving late
costs nothing.

There is a modelling reason too. A single `organization_id` on `user_profiles`
asserts that a person belongs to one organization, which is the thing ADR 0013
avoided by making membership its own table.

**"Fully populated" is true at the instant of the backfill, and not after.**
Consumers do not set the column until phase 6, so every row written between
these two phases is null. That is a consequence of the plan's own ordering
rather than a mistake in it, but it means **phase 7 must re-run the backfill
before adding `NOT NULL`**, not merely re-run the verification.

**audit_events got the bootstrap organization for every historical row**, with
no per-event-type map applied. R4 asks for one, and there was nothing for it
to disambiguate: every row predates the existence of a second organization.
The map becomes necessary when the trail spans more than one, and by then the
tenant arrives on the v2 envelope anyway. Persisting that is a consumer
change, so it belongs to phase 6; until then new audit rows are null.

**The backfill is in the migrations, not in an operator script.** That differs
from the membership backfill for a reason: each `UPDATE` here stays inside the
service's own database, and `prisma migrate deploy` is the only provisioning
step that runs both locally and in CI. Every statement is scoped to
`WHERE organization_id IS NULL`, so re-running is a no-op and cannot overwrite
a value a later phase set deliberately.

**The verification is a script**,
`infrastructure/postgres/operations/verify-tenant-columns.sh`, run with
`--snapshot` before migrating and without it after. It covers all four checks
above plus a fifth — that everything landed on the bootstrap organization,
which is what this phase expects and a later one will not.

Worth recording because it nearly produced a false clean: the ticket-agreement
check was wrong twice. A `LEFT JOIN` reports a ticket with no comments as a
disagreement, because `NULL IS DISTINCT FROM <uuid>` is true; and joining both
child tables in one query multiplies them into a cartesian product. The first
run flagged a ticket that was fine. Both mistakes are commented in the script.

### Phase 5 — read paths (9.3) — **in progress, and reordered**

Repository signatures take a **required** scope. Delete `isStaff`/`isAdmin`
(R6) and fix every resulting compile error. Enumerate use cases against the
check so `AssignTicketUseCase` is not missed (R3). Scope the users-service
directory, the audit filter and all five analytics aggregates in one commit
each (R5).

The Phase 0 tests must now pass.

**Checkpoint:** reads are tenant-safe; writes still accept anything. Revert =
revert the commits; columns and data survive.

**This phase now runs after phase 6's write half, not before it.** Following
the original order literally produces a broken product: reads would filter by
`organization_id` while writes still did not set it, so a ticket created in
that window would carry a null organization and its own author would not find
it. Writes first has no such state — the leak window is unchanged from today,
because reads were already unscoped — and the reads then scope data that is
already labelled correctly. The checkpoint above inverts accordingly: writes
are tenant-safe first, and reads are scoped service by service after.

**Done so far (`e6e1818`):** tickets-service. `findById` takes the
organization before the id and uses `findFirst`, so a foreign ticket answers
null exactly as a missing one does — a 404 rather than a 403, because
confirming existence is the leak. `TicketListFilter.organizationId` is
required while every other field stays optional, which is what turns R1's
"missing scope must be a compile error" into something the compiler actually
enforces. The in-memory double enforces the scope for real, so a unit suite
cannot pass against a leaking repository.

**Done (2026-07-31):** the rest. The audit filter takes a required
organization (`67f1906`); the five analytics aggregates changed signature in
one commit as R5 demanded (`078da2d`); the users-service directory is scoped
through a membership projection (`8f04f02`) — `user_profiles` still has no
organization column, because one column would assert one-org-per-person
(ADR 0013), so the projection is the scope. `isStaff`/`isAdmin` and the
duplicate `Actor` copies were deleted in one change (`a0aa60f`), which
forced the first permission-evaluator increment into existence: `perms`
resolves from the role template through a code map (ADR 0015's amendment
records why not seeded rows, and the three marked interim widenings on the
agent template).

**Deviation: phase 5 shipped consumers-adjacent work too.** Scoping the
directory needed membership data, which needed the membership lifecycle
events, which are phase 6 — the same dependency inversion that put writes
before reads. The phases interleaved rather than ran in sequence, and the
checkpoint that matters — every organization-owned read requires a tenant —
holds.

### Phase 6 — write paths and consumers (9.4) — **write half done**

Writes set the organization from the actor's claim, never from input.
Consumers read v2 and reject envelopes with no organization (R15/T15).
notification-service compares tenant as well as id. Membership lifecycle:
invite, activate, suspend, deactivate, with refresh revalidation (R7).

**Checkpoint:** the platform is tenant-safe on both paths while columns are
still nullable. Revert = still possible.

**Done (`d87e187`), ahead of phase 5 for the reason recorded there:** every
write in tickets-service and ai-service takes the organization from the
token. `requireOrganization` is the only bridge from the actor's optional
organization to the domain's required one, so forgetting the check is a type
error rather than a row belonging to nobody — the same argument ADR 0015 uses
for deleting `isStaff` instead of changing its signature.

**Membership resolution now fails closed, but only on uncertainty.** The
distinction the resolver has preserved since phase 2 is what makes that safe:
`null` means "asked, and this person belongs nowhere" and still mints a token
with no tenant claims, because that is the ordinary state of an account
between registering and the consumer creating its membership. A throw means
"could not ask", and refuses — as a **503**, not a 401, since the caller's
password was fine. The first case is then caught at the write.

**The caller-versus-ticket debt phase 3 recorded is discharged.** A comment or
history entry takes the _ticket's_ tenant, not the writer's, and a mutation
insists the caller is acting inside the ticket's organization rather than
merely able to see it.

**Done (2026-07-31):** the rest of the phase.

- **Consumers read the tenant-carrying stream** (`67f1906`, `078da2d`,
  `8ece501`): v2 processed under a consume-side guard that dead-letters a
  tenantless envelope; v1 twins acknowledged as explicit no-ops. Not dropped
  from the subscription, deliberately: the client only ever binds, never
  unbinds, so removing v1 contracts would leave the durable queues' v1
  bindings delivering messages nothing decodes — and processing both versions
  would double-apply every fact under two envelope ids. Every write requires
  an organization since `d87e187`, so every v1 fact has a v2 twin and acking
  v1 loses nothing. Phase 8 removes the bindings with queue surgery.
- **notification-service compares tenant as well as id** (`8ece501`): a
  follow-up whose organization does not match the stored ref dead-letters,
  and the assigned path resolves the ref purely for that comparison.
- **Membership lifecycle** (`4e68f93`): transitions, a version bump per
  transition, born-tenant-carrying events, an internal guarded status PATCH
  as the operator surface. Suspension takes effect at next refresh because
  refresh re-resolves rather than copies (R7's bounded staleness), and
  assignment closes even that window by asking live.
- **Assignee validation** (`3968b7f`, R3): a synchronous, fail-closed check
  against organizations-service — active membership under the ticket's
  organization, active organization, the can-take-a-ticket grant. ADR 0014's
  amendment records the boundary this drew: high-consequence mutations may
  ask synchronously, read paths never do.
- **The backfill re-run** phase 4 demanded: executed and verified 2026-07-31,
  all five checks green (and all five now flip the verifier's exit code —
  previously only the count comparison did).

### Phase 7 — enforce (9.4) — **done, with two structural exemptions**

Only after the verification in phase 4 has been re-run and passes: set
`NOT NULL`, add composite indexes with `organization_id` first, and make the
scope non-optional in every remaining type.

**Checkpoint:** the database now refuses an untenanted row. **This is the
first irreversible step** — reverting past it requires making columns nullable
again, which is safe but is a migration rather than a code revert.

**Executed 2026-07-31 (`88b2cd6`), approved.** Seven tables constrained.
`user_snapshots` and `audit_events` were nullable **by design**, not by
omission: registration is anonymous, created the snapshot row before the
membership event supplied a tenant, and is recorded by the firehose as the
structurally tenantless `user.registered.v1` forever. The checkpoint holds
where it can mean anything — every table whose rows are always attributable
refuses an untenanted one — and the exempt tables' scoped reads already
exclude nulls. Full record: `tenancy-phase-7-readiness.md`.

**Amended 2026-08-04 (Sprint 10.7, ADR 0026): `user_snapshots` is no longer
exempt, and `audit_events` is now the only one.** The exemption was not
"resolved" in either of the two ways this plan and the readiness document
anticipated — it was removed, because the tenantless WRITE was removed.
`user_snapshots` stopped recording registrations and became a projection of
the membership edge, keyed on `(user_id, organization_id)`.

It was not a tidy-up. The nullable tenant was stamped first-come-wins, and the
first to come was always the bootstrap membership — so every real organization
counted approximately nobody. **The classification below, which lists this
exemption under "what deliberately remains, and is not scaffolding", is
therefore superseded for this table**; leaving it standing would tell the next
reader that removing it was a mistake. `audit_events` keeps that
classification, and permanently.

### Phase 8 — legacy cleanup (9.4) — **done**

Stop publishing v1 events once every consumer reads v2. Remove the `roles`
compatibility claim once every call site reads `perms`. Scope the documented
rebuild paths and update `data-ownership.md` in the same change (R13). Fix the
stale line at `data-ownership.md:44` while there.

**Checkpoint:** no compatibility scaffolding remains.

**Executed 2026-07-31 (`1a09a56`, `87289bb`), approved.** The dual publish
ended and the five v1 contracts are deleted; `user.registered.v1` lives on,
being the only version an anonymous fact can have. The queue surgery is the
client's own: subscriptions declare `retiredBindingKeys` and every boot
unbinds them idempotently, proven against the real broker including a
pre-seeded stale binding. The `roles` claim is gone from the token while the
login/refresh/me responses keep `user.roles` from the user row —
authorization reads `perms`, and the product's role names never belonged in
the claim. users-service dropped its projected `roles` column (R14's stale
copy), and `Actor` took its final shape: `permissions` required,
`organizationId` deliberately optional because belongs-nowhere is a state
the product mints on purpose. The rebuild paths became per-organization by
construction (R13), with the two residual GAPs named in `data-ownership.md`.

**What deliberately remains, and is not scaffolding:** the two
nullable-by-design tenant columns (phase 7's exemptions), the
`retiredBindingKeys` literals until every environment's durable queue has
booted past this version once, and the code-map permission evaluator pending
the template-vocabulary decision.

## Rollback and recovery

- **Phases 0–6 are code reverts.** Columns are nullable and populated; the
  application simply stops reading them.
- **Phase 7 is the boundary.** After it, rollback is a forward migration
  making columns nullable again — safe, but not a `git revert`.
- **No phase deletes data.** Backfill is additive. If a backfill is wrong, the
  fix is to re-run it, which is why phase 4's verification queries are part of
  the plan and not an afterthought.
- **The bootstrap organization is never deleted.** Every pre-migration row
  belongs to it permanently; it is the recovery anchor for anything whose
  tenant cannot be re-derived.

## Explicitly not in this plan

Cache migration — there is nothing to migrate. Redis is connected to nothing
and no in-memory cache exists (T16). The requirement is a convention for the
first cache key, recorded now so it is not discovered later.
