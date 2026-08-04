# Sprint 10.7 — Counting people in the organization they are actually in

Status: **CLOSED (2026-08-04).** Remote CI green on the final HEAD: run
[`30876633036`](https://github.com/AgustinMartinezSM/helpdesk-ai/actions/runs/30876633036)
on `b8b13fc`, first attempt — the run in which the migration was applied and
the new integration case executed for the first time anywhere, since Docker was
not available locally. `counts one person in BOTH organizations, against the
real composite key` passed there. The Definition of Ready below was written and
checked against the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 10.6 is merged and closed with remote
CI green: run `30869580026` on `d5a6820`, plus its closing record — run
`30869821960` on `a146f38`. `main` equals `origin/main` at `a146f38`, working
tree clean. The last sprint document is `SPRINT-010.6.md`.

### The defect, verified rather than assumed

`user_snapshots` is the only table in the platform keyed on `userId` **alone**,
with a nullable `organization_id`. The write path is two events and the tenant
is first-come-wins:

1. `user.registered.v1` inserts `{userId, registeredAt}` with no organization.
2. `membership.created.v1` stamps one in, but only
   `WHERE user_id = $1 AND organization_id IS NULL`.

And the first membership every account ever gets is the **bootstrap** one:
`EnsureMembershipUseCase` creates it while consuming that same registration
event, and publishes `membership.created.v1` for it. So the holding pen claims
the row, and no later membership can move it — the repository says so itself:
_"a person in two organizations is still counted in exactly one — the first to
claim them."_

The consequence is worse than that sentence admits, and this is what makes it a
defect rather than a known limitation: **the first to claim them is always the
holding pen**, so `GET /analytics/summary`'s `totalUsers` returns approximately
**zero for every real organization**, and every person in the platform is
counted in the migration's bootstrap organization.

Nothing covers it. The integration suite exercises one membership per person;
no test anywhere asserts what happens on the second.

**This sprint did not cause it and is not the first to notice it** — Sprint
9.8 recorded it as a known limit and 10.6 recorded it again. What is new is
the reading above: it is not "counted in one of two", it is "counted in the
wrong one, always".

### The decision, and the three alternatives it beat

**`user_snapshots` stops being a person and becomes what every reader has
actually used it as: a projection of the membership edge.** Composite primary
key `(user_id, organization_id)`, `organization_id` **NOT NULL**, one row per
membership, written only by `membership.created.v1`.

**The registration write path is deleted, not adapted.** It exists to make a
column marginally more accurate, and that column has **no reader** — nothing in
`get-summary` selects it, and `users.total()` is a `count` that projects
nothing. Keeping a tenantless row would mean keeping the exemption below and
inventing a rule for which of several rows carries the "real" timestamp.

**`registeredAt` is renamed `joinedAt`.** After the rekey it is that edge's
creation time on every row, which is already what the membership create path
writes and calls "the honest nearby value". Leaving the old name would ship a
column whose name is false on every row but the first.

The alternatives:

- **A sentinel tenant for registration-first rows** — rejected: a magic value
  in a column documented as an opaque tenant id is this bug wearing a hat, and
  the tenancy verifier's orphan check would flag it on every run, correctly.
- **Buffering the registration apply in the consumer** — the readiness
  document's own first option, rejected: it needs state and a timer in a
  consumer that has neither, on a `prefetch: 1` queue shared with ticket
  projection, so a held message stalls unrelated work. It buys durability for a
  column nobody reads.
- **Keeping it nullable behind partial unique indexes** — rejected: it is the
  most complex write path of the three rather than the least, it keeps
  `registeredAt` ambiguous forever, and a late registration for an
  already-tenanted user leaves a permanent null row that counts for nothing.

### What this reverses, and why it needs an ADR rather than a quiet edit

The nullable `organization_id` here is **one of exactly two deliberate
exemptions** from the phase-7 NOT NULL enforcement, and
`tenancy-migration-plan.md` classifies it under "what deliberately remains, and
is not scaffolding". `verify-tenant-columns.sh` names it in
`NULLABLE_BY_DESIGN` beside `audit_events`.

**The exemption closes by a route the readiness document never enumerated.** It
offered two ways out — buffer the apply, or keep it nullable and document it —
and this takes neither: it removes the tenantless **write**, so there is
nothing left to exempt. `audit_events` remains the only exemption, and that one
is structurally permanent (the firehose records the tenantless
`user.registered.v1` forever).

Reversing something a migration plan calls "not scaffolding" is a decision
record, not a comment edit. There is no ADR for the exemption today — the
comments **are** the record — so this sprint writes the first one.

### The repair, and the plain statement about it

**Rekeying alone changes the code and leaves every existing number exactly as
broken as it is today.** No new `membership.created.v1` fires for people who
already joined, consumed events are gone, and there is no outbox (ADR 0006).
Replaying from the audit firehose would reconstruct a history of edges, some of
which were later suspended — a worse answer than reading current truth.

So the repair is an **operator script**, and the repository already names the
gap: `data-ownership.md` says the missing piece is _"a reconciliation script
against `helpdesk_organizations` (the `backfill-directory-memberships.sh`
pattern), which is not built"_. ADR 0003 forbids a **service** from reading a
peer's database; it does not forbid a migration or an operator script, and this
repository does exactly that twice already.

Two deliberate differences from the script it copies: it inserts
`ON CONFLICT DO NOTHING` rather than updating, because the only non-key column
is a timestamp nothing reads; and it **never deletes** — bootstrap-stamped rows
that no membership backs are reported with the statement an operator can run,
which is the stance Sprint 9.16 established for orphans.

### The invariants this stresses, and how each is met

| Invariant                                           | How                                                                                   |
| --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A projection never reads another service's database | The repair is an operator script, not service code — the precedent both backfills set |
| No untenanted row survives phase 7's intent         | Strengthened: the last non-structural exemption closes                                |
| Redelivery is a no-op                               | `ON CONFLICT DO NOTHING` on the composite key; at-least-once delivery is unchanged    |
| A registration cannot dead-letter                   | The arm and its binding go in the SAME change as the NOT NULL — see the risk below    |
| Aggregates stay per-organization                    | `total()` is unchanged; it simply stops undercounting                                 |
| The doubles behave like the database                | The in-memory double is corrected in the same commit, with a red test first           |

### The two failures this is most likely to produce

**There is no safe intermediate deploy.** `NOT NULL` while
`user.registered.v1` is still bound would dead-letter **every registration** —
precisely the failure that forced `audit_events` to be exempted during phase 7
itself. The migration, the consumer arm and the binding retirement land
together, and the integration suite asserts that a registration now produces no
row **and no dead letter**.

**The in-memory double disagrees with Prisma today, in the direction that hides
this bug.** Prisma stamps only a null organization; the fake **unconditionally
overwrites**, moving a person between tenants — the thing the repository's
comment says must never happen. Nothing pins either behaviour, so fixing only
the SQL would leave a green unit suite certifying semantics the database does
not produce. This is the R2 lesson for the third time (R2, then 9.12's team
predicate, now this). **The red tests come first and fail in opposite
directions**: the unit one because the fake overwrites, the integration one
because Prisma refuses the second membership. That asymmetry is the divergence
the sprint exists to close.

## What this sprint is, and is not

**In scope:** the rekey and its migration; deleting the registration write path
and retiring its binding key; the `joinedAt` rename; correcting the in-memory
double; red-first tests at unit and integration level; the operator repair
script; the tenancy operations scripts and their prose; an ADR; and the
documentation sweep across the nine sites that describe the old design as
deliberate.

**Out of scope, and deliberately:**

- **Decrementing the headcount.** Nothing consumes
  `membership.status-changed.v1` and no port method deletes a row, so after
  this sprint a person leaves a permanent row in every organization they ever
  joined. **The number moves from understating to potentially overstating**,
  and this sprint must claim only that it is now per-organization, never that
  it is correct. It is the immediate next increment and it carries its own
  question — does a suspended member count?
- **Service-code reconciliation** in the Sprint 9.16 shape. It would need a
  paginated membership snapshot endpoint that does not exist (both internal
  membership routes are per-user lookups), plus an `INTERNAL_SERVICE_TOKEN` and
  an HTTP layer analytics-service does not have. The script covers the repair
  without any of it.
- **Making `INTERNAL_SERVICE_TOKEN` required in auth-service.** Zero file
  overlap, and its first failure is an env-validation error in the unit step —
  which, bundled with a migration, would present as an auth error while
  somebody debugs Prisma. It also carries its own decision (what the resolver
  override should answer) and its own trade (the suite stops booting the real
  provider branch). Carried forward deliberately, not forgotten.
- **`audit_events`' exemption**, which is structural and permanent.
- **`ticket_snapshots`** in any form, and **`apps/web`** — no page reads
  `totalUsers`.

## Definition of Done

- One person in two organizations is counted in **both**, proved at unit and
  integration level, with both tests written red first.
- A registration produces no row and no dead letter.
- `organization_id` is NOT NULL and the composite key is the primary key.
- The operator script repairs an existing database from
  `helpdesk_organizations`, is idempotent, and reports rather than deletes.
- `NULLABLE_BY_DESIGN` names only `audit_events`, and every one of the nine
  sites describing the old design is corrected — including the migration plan's
  "not scaffolding" classification, which otherwise tells the next reader that
  removing this was a mistake.
- The sprint record claims the count is per-organization, and says plainly that
  nothing decrements it.
- Full gate, focused Conventional Commits, `--ff-only` to `main`, remote CI
  green on the final HEAD, clean tree, and `CURRENT-HANDOFF.md` naming the next
  exact action.

## Outcome

`GET /analytics/summary` reports a real organization's headcount instead of
approximately zero, and a person in several organizations is counted in each.
The decision is **ADR 0026**.

### What was built

`user_snapshots` keyed on `(user_id, organization_id)` with a NOT NULL tenant;
one row per membership; `registeredAt` renamed `joinedAt`; the registration
write path deleted and its binding retired; the in-memory double corrected;
and `backfill-user-snapshots.sh`, the repair script `data-ownership.md` had
been naming as missing.

### The part worth carrying: two red tests that failed in opposite directions

The unit test and the integration test were written before any production line
changed, and they did **not** fail the same way.

- The **unit** test failed because the in-memory double **overwrote** the
  tenant, so the second membership moved the person and the first
  organization dropped to zero.
- The **integration** test failed because Prisma **refused** the second
  membership — `updateMany ... WHERE organization_id IS NULL` matched nothing
  and the follow-up insert hit the old primary key — so the second
  organization stayed at zero.

That asymmetry is the whole finding. The double was more permissive than the
database, in exactly the direction that hid the defect, and **nothing pinned
either behaviour**. Fixing only the SQL would have left a green unit suite
certifying semantics production does not produce. This is the R2 lesson for the
third time in this repository — R2, then Sprint 9.12's team predicate, now this
— and it is the first time both sides were written red first.

I could only watch the unit one fail locally; Docker is not running here, so
the integration red is reasoned rather than observed, and the typecheck failure
on `findUnique({ where: { userId } })` is the part of it I did see.

### What the exemption turned out to cost

`user_snapshots` was one of two deliberate exemptions from the phase-7 NOT NULL
enforcement, and the readiness document called keeping it "the honest cheap
option". It was cheap. It was not harmless: keeping the column nullable kept
the tenant first-come-wins, and the first to come is always the bootstrap
membership that the registration event itself creates. Four sprints of every
real organization counting nobody followed from that one choice, and the two
sprints that noticed the shape of it both described it too generously.

The exemption closes by a route that document never enumerated. It offered two
— buffer the apply, or document the null — and both assumed the tenantless
write had to survive. It did not.

### What this sprint refused to claim

**The number is now per-organization. It is not correct.** Nothing consumes
`membership.status-changed.v1` and no port method deletes a row, so somebody
suspended or removed leaves a permanent row in every organization they ever
joined. The count has moved from understating to potentially overstating, and
in a churned organization `totalUsers` means "people who ever joined". Named as
the immediate next increment, in `pilot-readiness.md` and in the ADR.

**And the migration repairs nothing.** Which organizations a person belongs to
lives in another database, so every existing environment keeps reporting the
old numbers until an operator runs the script. That is stated in the migration
header, the script header, the ADR and here, because a fix nobody deploys the
second half of is not a fix.

### Verification

Full gate green: format, lint, typecheck across 15 projects, **1327 unit tests
across all 15**, and build.

Three levels: unit with a corrected double; the consumer spec pinning the
binding list, the retired key and that a registration now writes nothing at
all; and integration against real PostgreSQL and RabbitMQ — one person, two
organizations, asserted through the composite lookup as well as the aggregate,
because a surviving `user_id` uniqueness would make the second insert a silent
no-op that `total()` alone could not distinguish from a correct answer.

**The integration suite ran on CI, not locally** — Docker is not running on
this machine, for the fourth sprint running.

### Documentation

- **ADR 0026** — new, and the first record of a decision whose only previous
  documentation was the comments it reverses.
- **`tenancy-migration-plan.md`** — the exemption's "not scaffolding"
  classification is superseded for this table, in those words.
- **`tenancy-phase-7-readiness.md`** — the outcome appended: neither
  enumerated option was taken, and what the cheap one cost.
- **`data-ownership.md`**, **`pilot-readiness.md`**, the two tenancy operations
  scripts, and **`CURRENT-HANDOFF.md`**.

No fictional experience, customer, testimonial, incident, external approval or
commercial adoption was introduced.
