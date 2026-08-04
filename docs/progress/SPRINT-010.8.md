# Sprint 10.8 — A headcount that goes down, and a credential that must be there

Status: **OPEN.** The Definition of Ready below was written and checked against
the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 10.7 is merged and closed with remote
CI green: run `30876633036` on `b8b13fc`, plus its closing record. `main`
equals `origin/main` at `d5e5960`, working tree clean. The last sprint document
is `SPRINT-010.7.md`.

**Docker is running on this machine for the first time in five sprints.**
10.4, 10.5, 10.6 and 10.7 all ran their integration suites on CI only. The
compose stack is up before this sprint starts, so every claim below about a
real database and a real broker is meant to be verified here as well as there.

### Why this sprint is three things and not one

The handoff names them in order of consequence, and they share no file:

1. **Nothing decrements an organization's headcount** — the defect Sprint 10.7
   created a cleaner version of and named as the immediate next increment.
2. **`INTERNAL_SERVICE_TOKEN` is optional in auth-service**, which makes a
   misconfigured deployment mint tenant-less tokens instead of refusing to
   boot.
3. **The remaining visual debt in `design-system.md`.**

They are sequenced, not merged: item 2 lands in its own commit because its
first failure is an env-validation error in the unit step, and a
migration-shaped sprint that suddenly fails auth env validation reads as a
Prisma problem for as long as it takes to look.

### Item 1 — the defect, verified rather than assumed

`user_snapshots` records one row per membership edge since Sprint 10.7, and
**`MetricsConsumer` subscribes to `membershipCreatedV1` and nothing else**.
There is no `applyStatusChanged` on `UserSnapshotRepository`, no port method
that deletes, and no column that could hold the answer: the row is
`(user_id, organization_id, joined_at)` and `joined_at` is documented as the
only non-key column, which nothing reads.

So `GET /analytics/summary`'s `totalUsers` counts **every person who ever
joined**. Suspend somebody, remove somebody, remove everybody — the number does
not move. Sprint 10.7 said this plainly in its own record rather than letting
it be discovered, and `pilot-readiness.md` carries it as an open item.

`backfill-user-snapshots.sh` says the same thing from the operator's side and
names the fix precisely: _"Making the headcount active-only is a separate
change, in both places at once."_ This is that change, and both places means
the live write path **and** that script.

### Item 1 — decision A: what the number means

**`totalUsers` counts memberships whose status is `active`.**

This is not a free choice between equally good readings; the product has
already answered the question everywhere else:

- The people directory **defaults to active members**
  (`prisma-user-profile.repository.ts:92`, `statuses = ['active']`), and
  `?status=all` is the widening.
- Assignment re-checks `status: 'active'` against the stored row rather than
  trusting a token (`prisma-membership.repository.ts:195`).
- Membership resolution at mint time prefers an active real membership.

A dashboard that answered a different question from the screen listing the same
people would be the "two numbers, one question" defect this repository keeps
finding, and the People screen is the one somebody would check the dashboard
against.

The alternatives:

- **Count everything except `deactivated`** (active + suspended) — rejected. It
  reads as "the roster", which is an HR question this product does not ask;
  every other surface treats a suspended person as somebody who cannot act, and
  this number sits next to open-ticket counts.
- **Keep counting every edge and add a second figure** — rejected. Two
  headcounts on one dashboard need a vocabulary the product has not got, and
  the wrong one would still be the prominent one.
- **Count what the token can act as** — rejected as a rephrasing: that is
  active, reached by a longer route.

**The filter is `status = 'active'`, not a list of excluded statuses.** The
membership contracts type `status` as a min-1 **string**, on purpose, so the
vocabulary can move without a breaking contract change. A rule stated as
"exclude suspended and deactivated" would count a status invented in a later
sprint; stated as "count active", an unknown status simply does not count.
Fail-closed, and it never needs to know the vocabulary.

### Item 1 — decision B: a status column, not a delete

**`user_snapshots` gains `status` and `last_event_at`, and the consumer gains a
`membership.status-changed.v1` arm.** Nothing is ever deleted.

Deleting the row on `deactivated` was the first idea and it is wrong three
ways:

- `deactivated` **stopped being terminal in Sprint 9.10** — a person can be
  reactivated — so a delete would have to be undone by an insert whose
  `joined_at` nobody has any more.
- It discards the LWW watermark, so a **stale** `deactivated` replayed after a
  newer `active` would delete a row that should exist. With a watermark the
  same replay is refused by the guard, which is how every other projection in
  the platform behaves.
- It makes redelivery non-idempotent in the one direction that looks fine
  (delete twice) and destroys the evidence that would explain the number.

`last_event_at` is the LWW clock and takes the **payload's own timestamp**
(`createdAt` on created, `changedAt` on status-changed), which is what
users-service's directory projection does with the same three events. Two
services projecting the same events must order them the same way, or the
directory and the dashboard drift apart under replay.

**A status-change for an edge this projection has never seen creates the row.**
users-service already decided this asymmetry for the same events: a lost
`created` event must not make a live person invisible, and the operator script
reconciles the truth. Analytics has it easier than the directory did — it
invents no role template, because it stores none — so the placeholder is the
event's own facts plus `joined_at = changedAt`, the honest nearby value.

### Item 1 — decision C: what the migration backfills, and why it is not a guess

Existing rows get `status = 'active'` and `last_event_at = joined_at`.

Both are reconstructions rather than defaults, and that distinction is the
reason this is acceptable:

- Every row in this table was written by `membership.created.v1`, and **every
  membership creation path in the platform creates it `active`** — invitation
  redemption, the bootstrap membership, and the organization-creation owner.
  So `'active'` is what the projection would have stored at insert time.
- `last_event_at` would have been the created event's timestamp, which is
  exactly what `joined_at` already holds.

What the migration **cannot** reconstruct is any status change since, because
nothing ever consumed those events — they are gone. That is not a defect of the
migration, it is the same statement Sprint 10.7 had to make: **the code is
fixed and the existing numbers are not, until an operator runs the script.**
The migration header, the script header and the sprint record all say so.

### Item 1 — the script has to change in the same sprint

`backfill-user-snapshots.sh` currently inserts `ON CONFLICT DO NOTHING`, and
its comment explains why: the only non-key column was a timestamp nobody read.
That argument dies with this change. It becomes:

```
ON CONFLICT (user_id, organization_id) DO UPDATE
  SET status = EXCLUDED.status, last_event_at = EXCLUDED.last_event_at
  WHERE user_snapshots.last_event_at <= EXCLUDED.last_event_at
```

— the same guard as the live path, so a run that races a live event cannot
regress it, and `joined_at` still is never rewritten. The source columns are
`memberships.status` and `memberships.updated_at`.

**`updated_at` is bumped by role changes too**, so the script's watermark can
sit slightly ahead of the last status transition. Stated rather than hidden:
the consequence is that an in-flight status event older than that watermark is
refused — and it is refused correctly, because the status the script just read
is the newer truth.

### Item 2 — `INTERNAL_SERVICE_TOKEN` becomes required in auth-service

Its own env comment has been carrying the condition since Sprint 9.2: _"It has
to become required in the phase that makes the claims decide something."_ That
phase is four sprints past. The claims decide the tenant of every write, every
permission check, and since 10.6 which organization somebody is working in.

Unset today, `MEMBERSHIP_RESOLVER` is provided as `null`, `SessionService`'s
`resolveMembership` returns `null` on that branch — and `null` means **"this
person belongs to no organization"**, which is a different sentence from "I did
not ask". A deployment that forgot the variable therefore logs one warning at
boot and then mints tenant-less tokens forever, and the product fails at every
write with a 403 that names nothing. **Fail-open at the deployment layer,
inside the one service whose fail-closed rule is written into an ADR.**

**Two changes, and the second is the one that makes it structural.** The env
field loses `.optional()`, and `SessionService`'s `memberships` parameter
loses its `?`. With the module always providing a resolver, the
`if (!this.memberships) return null` branch is not dead code to leave lying
around — it is the lie itself, and deleting it makes the state unrepresentable
rather than merely unreachable. Same move as `requireOrganization` being the
only bridge, and as the partial unique index for ownership.

**`it('mints without tenant claims when no resolver is configured')` is
deleted, and the deletion is part of the decision** — it pins behaviour this
sprint is removing, exactly as 10.6 deleted the tests for the
second-organization refusal it lifted.

**What the integration suite's resolver override answers: a real membership.**
The suite boots the real module against real Postgres; after this change there
is no production configuration in which auth mints without asking, so an
override answering `null` would keep the suite exercising a shape that no
longer exists. Answering a membership also buys the assertion this repository
learned to want in 10.6: **decode the signed access token and check the claims
are on it** — `tm` was absent from every signed token for four sprints because
the tests asserted what a fake issuer received, not what was signed. The real
HTTP flow has never once decoded its own token.

The belongs-nowhere and cannot-ask paths keep their coverage where it already
lives — `session-claims.spec.ts`, at unit level, with the resolver injected
directly.

### Item 3 — the visual debt, and the half of it that is a refusal

`design-system.md` lists two open items:

- **No Checkbox/Radio/Dialog/Banner/Tooltip primitives.** This stays open and
  the document already says why: nothing in the product needs one, and
  inventing them ahead of a use case invents their API too. **Not building it
  is the decision**, and this sprint's job is to leave that sentence standing
  rather than quietly satisfy a checklist.
- **No authenticated screen has ever been looked at in a browser.** Docker is
  running, so this one is attempted here. It verifies nothing this sprint
  builds — the sprint changes no pixel — so it is discharging old debt, and
  whatever it finds is reported as a finding rather than folded into the code
  under some other heading.

The six-servers-against-five-slots ceiling from 9.10 and 9.13 still applies;
the sprint record will say which screens were actually seen and which were not.

### The number this sprint takes, and what it displaces

`design-system.md`, `brand-strategy.md` and the handoff all say **"complete
internationalization is Sprint 10.8"**. That is now false, and three live
documents saying it is worse than one.

**i18n is renumbered to 10.9** in those live documents, in the opening commit —
the same move Sprint 9.11 made when it took routing's number. Historical sprint
records that name 10.8 are **left alone**: they are dated records of what was
believed then, and rewriting them is how a record stops being one.

### The invariants this stresses, and how each is met

| Invariant                                                | How                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Redelivery is a no-op                                    | LWW guard on `last_event_at`, evaluated inside Postgres; ties resolve to the later arrival |
| A stale replay never regresses newer truth               | `WHERE stored.last_event_at <= incoming` on both the live path and the script              |
| The double behaves like the database                     | The in-memory fake mirrors the new SQL exactly, with a red test first                      |
| A projection never reads another service's database      | The repair stays an operator script                                                        |
| No projection freezes an unfrozen vocabulary             | The count filters on `active`; any other status is stored verbatim and simply not counted  |
| Auth never guesses a tenant                              | Resolver required at the type level; the "no resolver" branch is deleted, not bypassed     |
| The dashboard and the directory answer the same question | Both mean active members, and the sprint cites where the directory's default lives         |

### The three failures this is most likely to produce

**A migration that adds a NOT NULL column to a populated table.** `status` and
`last_event_at` must arrive with their reconstruction in the same statement, or
the migration fails on any non-empty database — including every developer's.

**A green unit suite certifying semantics the database does not produce.** The
fake is where this bug lives by tradition: R2, then 9.12's team predicate, then
10.7's `user_snapshots` double, which overwrote where Prisma refused. The
status arm gets its red test at unit **and** integration level, and the two are
expected to fail for different reasons again.

**A silent double meaning for the placeholder row.** If a status-changed for an
unknown edge inserts a row with `status = 'suspended'`, that row must not count
— and if it inserts one with `status = 'active'`, it must. Both directions get
a test, because a placeholder that always counts is a headcount that goes up
when somebody is suspended.

## What this sprint is, and is not

**In scope:** the `status`/`last_event_at` columns and their migration; the
`membership.status-changed.v1` consumer arm, use case and port method; the
active-only count; the corrected in-memory double; red-first tests at unit and
integration level; the backfill script's guarded upsert; an amendment to ADR
0026; `INTERNAL_SERVICE_TOKEN` required in auth-service with the suite taught
to override the resolver, in its own commit; a signed-token claim assertion in
the auth integration flow; the i18n renumbering across the live documents; a
browser pass over authenticated screens; and the documentation sweep.

**Out of scope, and deliberately:**

- **A new ADR for the headcount.** ADR 0026 decided that this table projects
  the membership edge; deciding which edges count is a refinement of that same
  record, and this repository amends rather than restating premises in a second
  document. An amendment section, dated, in ADR 0026.
- **Checkbox/Radio/Dialog/Banner/Tooltip primitives** — see item 3; the
  refusal is the position.
- **Reconciliation for the remaining projections** (`directory_memberships`,
  `ticket_snapshots`, `ticket_refs`) in the Sprint 9.16 shape. `user_snapshots`
  gets a script, not a reconciler, for the reasons 10.7 recorded.
- **`apps/web`** — no page reads `totalUsers`; the endpoint has no screen.
- **Full i18n**, which is 10.9 as of this sprint.
- **Per-caller service credentials.** Making the credential required does not
  make it attributable, and the second thing needs its own design.

## Definition of Done

- Suspending somebody lowers `totalUsers`; reactivating them raises it again;
  proved at unit and integration level with both tests written red first.
- A status-changed event for an unseen edge creates the row, and it counts only
  when the status says active.
- A stale status event cannot regress a newer one, proved against real SQL.
- The migration reconstructs existing rows rather than defaulting them, and
  says in its header what it cannot reconstruct.
- `backfill-user-snapshots.sh` carries status under the same guard as the live
  path, stays idempotent, and still never deletes.
- auth-service refuses to boot without `INTERNAL_SERVICE_TOKEN`, naming the
  variable; `SessionService` cannot be constructed without a resolver; the
  integration suite overrides one and asserts the claims **on the signed
  token**.
- ADR 0026 carries a dated amendment; `pilot-readiness.md` closes both items;
  no live document still says i18n is 10.8.
- The sprint record says which authenticated screens were seen in a browser and
  which were not.
- Full gate, focused Conventional Commits, `--ff-only` to `main`, remote CI
  green on the final HEAD, clean tree, and `CURRENT-HANDOFF.md` naming the next
  exact action.
