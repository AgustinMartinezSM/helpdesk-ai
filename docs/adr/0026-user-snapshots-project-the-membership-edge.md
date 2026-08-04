# ADR 0026 — `user_snapshots` projects the membership edge, not the person

Status: **Accepted** (Sprint 10.7, 2026-08-04).

Reverses a deliberate exemption recorded in `tenancy-migration-plan.md` and
`tenancy-phase-7-readiness.md`. Those documents, plus the schema and repository
comments, were the only record of that decision — there was no ADR — so this is
the first one, and it exists to close what it opened.

## Context

`user_snapshots` was the only table in the platform keyed on `userId` alone,
with a nullable `organization_id`. Two events wrote it:

1. `user.registered.v1` inserted `{userId, registeredAt}` with no organization.
2. `membership.created.v1` stamped one in — but only
   `WHERE user_id = $1 AND organization_id IS NULL`.

Sprint 9.8 recorded the limitation in the repository's own comment: _"a person
in two organizations is still counted in exactly one — the first to claim
them."_ Sprint 10.6 repeated it. Both readings were too generous.

**The first to claim them is always the holding pen.** The first membership
every account ever gets is the bootstrap one, because organizations-service
creates it while consuming that very registration event and publishes
`membership.created.v1` for it. So the stamp always landed on `bootstrap`, no
later membership could move it, and `GET /analytics/summary` reported
approximately **zero users for every real organization** while the migration's
holding pen held everybody.

Nothing covered it. The integration suite exercised one membership per person;
no test anywhere asserted what happened on the second.

Two facts made it survivable to fix cleanly:

- **`registeredAt` had no reader.** `get-summary` runs five aggregates and the
  only one touching this table is a `count` that projects no columns.
- **The in-memory double disagreed with Prisma**, in the direction that hid
  the bug: the double overwrote the tenant unconditionally where Prisma refused
  to move a stamped row at all — the thing the repository's comment said must
  never happen. Neither behaviour was pinned by a test.

## Decision

**`user_snapshots` stops being a person and becomes a projection of the
membership edge.** Composite primary key `(user_id, organization_id)`,
`organization_id` **NOT NULL**, one row per membership, `registeredAt` renamed
`joinedAt`.

**The registration write path is deleted rather than adapted**, and the binding
is retired. A row with no organization answers nothing this projection is
asked — every aggregate filters on the tenant, so such a row falls out of all
of them — and keeping it is what made the tenant first-come-wins.

`applyMembershipCreated` collapses from two statements and a branch to one
`INSERT ... ON CONFLICT DO NOTHING` against the composite key. Redelivery is a
no-op and never rewrites `joinedAt`; a second organization inserts a second
row. Every ordering question the two-writer design had disappears with the
second writer.

### The exemption closes by a route the readiness document never enumerated

`user_snapshots` was one of exactly two deliberate exemptions from the phase-7
NOT NULL enforcement. The readiness document offered two ways out — buffer the
registration apply in the consumer, or keep the column nullable and document it
— and this takes neither. It removes the tenantless **write**, so there is
nothing left to exempt.

`helpdesk_audit.audit_events` is now the only exemption, and that one is
permanent: the firehose records the structurally tenantless
`user.registered.v1` forever.

This matters more than a schema note because `tenancy-migration-plan.md`
classifies the exemption under _"what deliberately remains, and is not
scaffolding"_. Left standing, that sentence tells the next reader that removing
it was a mistake.

### `registeredAt` becomes `joinedAt`

While one row stood for one person, the column could plausibly hold a
registration instant. Once a person has several rows it cannot: each row is a
different join, and the membership create path already wrote the membership
time and called it "the honest nearby value". Under any design that keeps
several rows, the old name is false on every row but one — and there is no rule
for which one.

### The repair is an operator script, and the plain statement about it

**Rekeying alone changes the code and leaves every existing number exactly as
broken as it was.** No new `membership.created.v1` fires for people who already
joined; consumed events are gone and there is no outbox (ADR 0006). Replaying
from the audit firehose would reconstruct a _history_ of edges, some of which
were later suspended or removed by events this projection does not consume — a
worse answer than reading current truth.

So `infrastructure/postgres/operations/backfill-user-snapshots.sh` reads
`helpdesk_organizations.memberships` and writes `helpdesk_analytics`. ADR 0003
forbids a **service** from reading a peer's database; it does not forbid a
migration or an operator, and this repository already does exactly that twice.
`data-ownership.md` had named this missing script by name.

Two deliberate differences from the script it copies: `ON CONFLICT DO NOTHING`
rather than `DO UPDATE`, because the only non-key column is a timestamp nothing
reads and rewriting it would churn every row on every run; and it **never
deletes** — rows the old path stamped with `bootstrap` that no membership backs
are reported with the statement to remove them, which is the stance Sprint 9.16
established for orphans.

### The deploy is not divisible

There is no safe intermediate state. `NOT NULL` while `user.registered.v1` is
still bound dead-letters **every registration**, because that handler passed no
organization at all — precisely the failure that forced `audit_events` to be
exempted during phase 7 itself. The migration, the consumer arm and the binding
retirement land in one change, and the migration header says so.

## What I considered and did not choose

**A sentinel tenant for registration-first rows.** A placeholder UUID so the
composite key is satisfiable. Rejected: a magic value in a column documented as
an opaque tenant id is this bug wearing a new hat — either every aggregate
learns to exclude one value, or the sentinel accumulates a shadow headcount —
and the tenancy verifier's orphan check would flag it on every run, correctly.

**Buffering the registration apply in the consumer**, the readiness document's
own first option. Rejected: it needs state and a timer in a consumer that has
neither, on a `prefetch: 1` queue shared with ticket projection, so a held
message stalls unrelated work. It buys durability for a column nobody reads.

**Keeping the column nullable behind partial unique indexes.** Rejected: it is
the most complex write path of the three rather than the least — the stamp
would need an anti-join guard so filling a null row cannot collide with an
existing edge — it keeps `joinedAt` ambiguous forever, and a late registration
for an already-tenanted user leaves a permanent null row counting for nothing.

**Splitting into `user_registrations` + `organization_members`.** The fully
honest decomposition, and not now: it costs a second table, repository and port
for a fact with zero readers. This decision leaves the door open — if
registrations-per-day is ever wanted it is a new table added then, not a column
rescued now.

**A reconciliation path in the Sprint 9.16 shape** — a paginated snapshot
endpoint plus a reconciler. It is the better long-term answer and it is a whole
sprint: no membership _listing_ endpoint exists (both internal routes are
per-user lookups), and analytics-service would need a service credential and an
HTTP layer it does not have. The script repairs the data without any of it.

## Consequences

**Every organization's headcount becomes its own**, and a person in several is
counted in each.

**The number moves from understating to potentially overstating, and this
record will not claim otherwise.** Nothing consumes
`membership.status-changed.v1` and no port method deletes a row, so a person
now leaves a permanent row in every organization they ever joined. In a churned
organization `totalUsers` means "people who ever joined". That is the immediate
next increment and it carries its own question — does a suspended member count?
— which is why it is not smuggled in here.

**Existing environments read the wrong numbers until an operator runs the
script.** Stated in the migration header, in the script header, and here.

**The in-memory double now mirrors the SQL**, and both are pinned by tests
written red first. This was the R2 lesson for the third time in this repository
(R2, then Sprint 9.12's team predicate, now this): a double more permissive
than the database certifies semantics production does not produce.

**`user.registered.v1` is not retired as a contract.** auth-service still
publishes it; organizations-service, users-service and the audit firehose all
still consume it on their own queues. Only this queue stopped caring, and its
retired binding key is the first entry in that list which is not a deleted
contract — worth knowing before somebody prunes the list.

## Amendment — Sprint 10.8: which edges count, and how the number comes back down

The record above says plainly that nothing decrements the headcount and names
that as the next increment, with its own open question. This amendment answers
the question and records the mechanism. It is an amendment rather than a new
ADR because the decision being refined is this one: what the table projects
was settled here, and "which of those edges count as a person" is a property
of the same projection, not a separate architecture.

**The answer to the open question: a suspended member does not count.**
`totalUsers` counts memberships whose status is `active`.

That is not a free choice between equally good readings. The product answered
it everywhere else first: the people directory lists active members by default
and takes `?status=all` to widen, assignment re-checks `status = 'active'`
against the stored row rather than trusting a token, and mint-time resolution
prefers an active real membership. A dashboard answering a different question
from the screen listing the same people would be the "two numbers, one
question" defect — and the People screen is precisely what somebody would
check the dashboard against.

Rejected: **everything except `deactivated`** (active plus suspended), which
reads as an HR roster this product does not keep, next to open-ticket counts;
and **two figures on one dashboard**, which needs vocabulary the product has
not got, with the wrong one still the prominent one.

**The filter names what counts, not what does not.** The membership contracts
type `status` as a free string on purpose, so the vocabulary can move without
a breaking contract change. "Exclude suspended and deactivated" would silently
count a status invented by a later sprint; "count active" means an unknown
status is not counted. The constant is exported from the domain and shared by
the SQL and the in-memory double rather than spelled twice — the last two
defects in this projection were a double and a repository disagreeing.

**The row carries `status` and `last_event_at`, and is never deleted.**
Deleting on `deactivated` was the first idea and is wrong three ways: that
status stopped being terminal in Sprint 9.10, so the delete would have to be
undone by an insert whose `joinedAt` nobody has any more; it discards the
watermark, so a stale replayed `deactivated` would remove a row that should
exist; and it destroys the evidence that explains the number. Both apply
methods are last-writer-wins upserts on the payload's own timestamp, which is
what users-service's directory projection uses for the same three contracts —
two services projecting the same events must order them identically or they
drift apart under replay.

**A status change for an unseen edge creates the row**, the asymmetry
users-service already settled: a lost created event must not make a live
person invisible. This projection has the easier half of it, storing no role
template, so the placeholder invents nothing — and a later created event
corrects its `joinedAt` **downward** through `LEAST`, because a membership's
creation time is by construction the earliest fact about an edge. The same
guard means that late created event cannot revive somebody suspended after
they joined, which is the failure ordinary out-of-order delivery would
otherwise produce.

**The migration reconstructs rather than defaults.** Every row was written by
`membership.created.v1` and every creation path in the platform creates a
membership `active`, so `'active'` is what the projection would have stored;
`last_event_at` would have been that event's timestamp, which `joined_at`
already holds. What it cannot reconstruct is any status change since — nothing
ever consumed those events and there is no outbox — so the operator script
stays the repair, and it now carries `status` under the same guard as the live
path. **Its orphan report was wrong and is fixed here**: the query written in
10.7 grouped every row with no filter and labelled them all unexplained,
directly above a suggested `DELETE`. An operator who trusted the label would
have deleted a healthy organization's projection. It is a real anti-join now,
and the suggested statement deletes by the pair rather than by organization.

**What this still does not claim.** The number counts active memberships as
this database has heard of them. A deployment that has never run the backfill
since 10.7, or that lost a status event with no replay, is still reporting
something older than the truth — which is the standing property of a
projection, stated rather than assumed.
