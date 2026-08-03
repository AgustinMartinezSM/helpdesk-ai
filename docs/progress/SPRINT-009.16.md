# Sprint 9.16 — Projection bootstrap and reconciliation

Status: **Implemented, closure incomplete (2026-08-03).** The Definition of Ready below was written and
checked against the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 9.15 is merged with remote CI green
(run `30793934764` on `1f6d194`, first attempt; the docs commit `15fb29d` ran
green too). `main` equals `origin/main` at `15fb29d`, working tree clean. The
last sprint document is `SPRINT-009.15.md`, so this is 9.16.

**This is item 1 of `docs/architecture/pilot-readiness.md`** — the
highest-severity finding, and the only piece of debt with a consequence
somebody would actually hit.

### The problem, as the repository states it

A consumer's durable queue is declared in `MessagingClient.startConsumer`, and
a topic exchange discards a message with no bound queue. So a service that
boots for the first time after its producers have been working starts with an
empty projection and fills only from the NEXT event.

I reproduced this before Sprint 9.15: `team_refs` and `branch_refs` were empty
in the tickets dev database despite branches existing since 9.5 and a support
team since 9.12, because tickets-service had never run on this machine while
those events were published.

**The consequence is not "a stale projection".** `CreateTicketUseCase`
validates `branchId` against `branch_refs` and refuses an unknown one with a
generic 422, fail-closed by design (9.5, D4). A cold tickets-service therefore
**refuses every located ticket** until somebody edits each branch to re-emit an
event. Editing an entity to make it publish is not a recovery mechanism — it is
a person doing by hand what nothing automated does, one row at a time, with no
way to know when they are finished.

### Two corrections to the brief, from the repository

**There is no `department_refs`, and this sprint must not create one.**
tickets-service projects `branch_refs`, `station_refs`, `team_refs` and
`team_branch_refs`, and nothing else. Departments publish **no contract at
all** — ADR 0022 states it directly: _"there is no department contract on
purpose (no consumer, no promise)"_, and 9.12 recorded that departments are the
requester's area with no bearing on ticket validation or routing. Building a
projection for them would invent a promise to satisfy a name in a plan.

**`station_refs` belongs in scope even though the brief does not name it.** It
is a projection with the same cold-start failure and it participates in ticket
validation: a station is validated against it at creation, and a cold one makes
every station-located ticket unfilable. Leaving it out because the list did not
say "stations" would fix four fifths of a problem.

### Product objective

tickets-service can rebuild every projection it needs from the service that
owns the data, at any time, without anybody editing a branch to make it
publish. A cold service becomes correct on its own; a drifted one can be
checked without being changed.

### Why this mechanism, and what was rejected

**Chosen: an internal, authenticated snapshot contract on
organizations-service, pulled by tickets-service.**

It preserves database ownership exactly — tickets-service asks the owner over
HTTP and never touches another service's database (ADR 0003, ADR 0013). It
reuses the credential and guard that already exist for exactly this shape of
call: `InternalServiceGuard` over `INTERNAL_SERVICE_TOKEN`, which since 9.11
guards precisely two read-only lookups, one of which tickets-service already
makes. tickets-service already has `ORGANIZATIONS_SERVICE_URL` and the token
configured. The addition is a third read-only lookup, in a shape the platform
has already agreed to.

**Rejected: replaying retained events.** The repository does not genuinely
support it. There is no event store: RabbitMQ's topic exchange retains nothing
after routing, ADR 0006 defers the transactional outbox, and audit-service's
trail — the only durable record of past events — lives in another service's
database, which reading would violate ADR 0003. It is also a firehose log built
for attribution, not a source of truth for rebuilding a peer's cache.

**Rejected: a read-through fallback that asks on a projection miss.** It looks
smaller and it reverses a deliberate decision: 9.5's D4 chose local validation
precisely so ticket creation would not make a synchronous cross-service call,
and ADR 0014's mutations-may-ask exception was written not to extend here. It
would also mask drift rather than fix it — every miss would silently succeed
and the projection would stay wrong forever.

**Rejected: a generic cross-service data-access layer.** Out of scope by
instruction and by judgement: three specific read endpoints for four specific
projections is the smallest thing that works, and a general mechanism would
invite exactly the coupling ADR 0003 exists to prevent.

### The race, and why composition solves it

Requirement 11 is the hard one: an update published between the snapshot being
read and the consumer catching up must not be lost. Two facts already in the
repository make it safe without a new mechanism:

1. **`MessagingClient.subscribe()` resolves only after the queue is declared
   and bound.** Its `setup` asserts the queue and binds every key before
   `channel.consume` is awaited. So once `start()` returns, nothing published
   afterwards can be discarded — it is queued whether or not the handler is
   busy.
2. **Every apply is last-write-wins on the source's own timestamp.** The SQL is
   `WHEN stored.updated_at <= EXCLUDED.updated_at THEN EXCLUDED...`, so a write
   carrying an older timestamp cannot overwrite a newer row.

Therefore the ordering rule is **subscribe first, snapshot second**, and the
snapshot is applied through the same LWW-guarded path the events use:

- published before the snapshot read → already in the snapshot;
- published after → queued, applied later, newer timestamp wins;
- published during → in one, the other, or both; LWW settles it either way.

That is the whole of requirement 11, and it needs no cursor table, no pause and
no lock.

### Technical scope (decisions D1–D11)

- **D1 — Three snapshot endpoints on organizations-service**, under
  `/internal/structure/*`, guarded by `InternalServiceGuard`: branches,
  stations and teams. Read-only, keyset-paginated by id, each row carrying its
  own `organizationId` and the source's `updatedAt` so the LWW guard works.
- **D2 — The snapshot is GLOBAL, not per organization.** A tenant with
  branches and no tickets yet is exactly the cold-start case, and
  tickets-service cannot enumerate organizations it has never seen. Rows state
  their own tenant, and the apply path writes that — so a global read cannot
  produce a cross-tenant row.
- **D3 — A team carries its branch scope inline.** The scope is a set, and
  fetching it separately would leave a window where a team exists locally with
  the wrong reach. One row, one truth, applied through the existing
  `applyScope`.
- **D4 — Reconciliation runs at boot, after the subscription is live**, as a
  fire-and-forget task like the consumer itself. This is what actually fixes
  cold start: no operator has to notice. It never blocks HTTP readiness, and
  running on every boot is safe because every write is idempotent under LWW.
- **D5 — And on demand, through an internal endpoint on tickets-service.**
  This is a write path behind `INTERNAL_SERVICE_TOKEN`, which 9.10 and 9.11
  deleted for membership and structure — so it needs its justification stated
  rather than assumed. **It is a different act.** Those endpoints changed
  DOMAIN state on behalf of a person with no person attached; this one changes
  no domain state at all. It converges a cache toward the source of truth,
  can only write rows the event stream would have written anyway, and can
  express nothing a person decided. The audit question those deletions were
  about — _who decided this_ — has no subject here.
- **D6 — Orphans are reported and never removed.** The domain semantics are
  that nothing is deleted: branches and teams archive, and archiving does not
  cascade (9.11, D4). So a local row with no source row means something else
  went wrong, and removing it silently would be repairing an ambiguous record.
  It is counted and logged; removal stays a human decision.
- **D7 — Archived state is ordinary state.** The snapshot carries `status`, so
  an entity archived while tickets-service was down is corrected by the same
  path that inserts a missing one. No special case.
- **D8 — Resume is re-run.** Every page is idempotent under LWW, so an
  interrupted reconciliation is recovered by running it again — there is no
  half-applied state to unwind and no cursor to persist. The endpoint accepts
  an explicit cursor for an operator who would rather continue than restart,
  and that is a convenience, not the correctness mechanism.
- **D9 — A dry run reads everything and writes nothing**, reporting the same
  counters. That is the integrity check: run it, read `inserted` and `updated`,
  and a healthy projection answers zero for both.
- **D10 — Structured results and logs carry counts and organization ids, never
  names, codes or ticket data.** `scanned, inserted, updated, unchanged,
archived, orphaned, failed` per projection.
- **D11 — No migration and no new table.** Nothing in the schema changes.

### Security boundaries

- **No service reads another's database.** The snapshot is HTTP, from the owner.
- **The internal surface stays off the gateway.** `/internal/*` is absent from
  the api-gateway routing table and the gateway strips
  `x-internal-service-token` from every inbound request, so a browser has no
  path to any of this.
- **A row states its own tenant and the apply writes that**, so a global
  snapshot cannot produce a cross-tenant relationship. A test asserts it
  against two organizations that both have a branch of the same name.
- **The reconciliation writes only projection rows.** It cannot create a
  ticket, a membership or a domain entity, and it cannot delete anything.
- **Nothing personal crosses.** Branches, stations and teams carry no personal
  data; the snapshot rows are codes, names, statuses and ids.

### Test strategy

The fourteen required scenarios, each named in its test. The cold start is
proven **end to end against real PostgreSQL and RabbitMQ**, not with mocks: the
integration test publishes structure events with no tickets queue bound, then
starts the consumer and reconciliation against an empty projection, then files a
located ticket through the real use case.

Beside those: the snapshot endpoints refused without the credential, keyset
pagination over more rows than one page, a dry run leaving row counts
unchanged, an orphan counted and not deleted, and an event published mid-run
surviving.

Full gate plus all nine integration suites before push, then remote CI.

### Explicitly out of scope

Email delivery, automatic routing rules, branding, the Helpi redesign,
WhatsApp, billing, SSO, SCIM, load testing. No `department_refs` (see above).
No generic cross-service data layer. No production or remote database access —
everything runs against the local compose stack.

### Ready?

The mechanism is the smallest one that preserves ownership, and the hardest
requirement — losing no update across the handover — is solved by composing two
properties the repository already has rather than by adding a third. No
migration. Proceeding under the standing autonomous authorization.

## Outcome record (2026-08-03)

Two commits: the opening (`6dea4fb`) and the implementation (`cb01c33`).

**A cold tickets-service repairs itself.** organizations-service offers three
read-only, keyset-paginated snapshot endpoints under `/internal/structure/*`;
tickets-service pulls them at boot after its subscription is live, and an
operator can run the same walk on demand or as a read-only drift check.

### What the implementation confirmed or decided

- **The race needed no new mechanism, and the code says why in one place.**
  The ordering lives inside `StructureEventsConsumer.onApplicationBootstrap`
  rather than in two coordinated call sites, because separating subscribe from
  reconcile is exactly how somebody reorders them later.
- **`department_refs` was not created.** The brief named it; the repository has
  no such projection and departments publish no contract at all (ADR 0022).
  Building one would have invented a promise to satisfy a name.
- **`station_refs` was added to scope** though the brief did not name it: same
  cold-start failure, and it gates station-located tickets.
- **tickets-service now ACCEPTS the service credential as well as presenting
  it**, so it grew its own `InternalServiceGuard` — a deliberate copy of
  organizations-service's rather than a shared one, because a library version
  would have to depend on each service's validated env type. Both rules it
  encodes (rotation accepted, no early return on the first comparison) are
  restated where they live rather than assumed from the other copy.
- **The on-demand endpoint is a write path behind the credential**, which 9.10
  and 9.11 deleted for memberships and structure. Justified explicitly rather
  than by silence: those changed DOMAIN state on behalf of a person with no
  person attached, so "who decided this" had a subject and no answer. This
  converges a cache toward its owner, can only write rows the event stream
  would have written anyway, and expresses no human decision.

### The test hang, and what caused it

The first full run of the tickets integration suite never finished and was
killed at eight minutes. **The tests were not slow — the process would not
exit.** Run alone with `--detectOpenHandles`, the new spec passed in under four
seconds; the fault was in the spec's own teardown: a helper created a
`MessagingClient` per test and `afterAll` closed only the most recently
assigned one, leaking two AMQP connections that jest then waited on forever.
Every consumer is now tracked and closed. The complete suite runs in 4.6s.

Worth keeping: a suite that passes and hangs is a teardown bug, not a slow
test, and `--detectOpenHandles` on the single spec is the fastest way to tell
the two apart.

### Verified

Full workspace gate green: format, lint, typecheck, test and build across all
15 projects. tickets-service 110 unit tests (13 new for the reconciliation) and
19 integration tests across 3 suites (4 new).

**The cold start is proven end to end against real RabbitMQ and PostgreSQL**,
not through mocks. The spec deletes the durable queue so the start is genuine,
publishes branch and team events with nothing bound, **asserts the projection
is still empty** — which is what proves the events were discarded rather than
merely delayed — shows a located ticket being refused, then reconciles and
shows the same ticket accepted, routed to an organization-wide team and to a
branch-scoped one. It also covers incremental events after the rebuild, an
older snapshot failing to overwrite a newer event, and a dry run writing
nothing.

No migration. No schema change.

### Not done in this sprint

The runbook and the ADR/pilot-readiness updates are owed. The remaining eight
integration suites were not re-run after the final change, and remote CI has
not run. The snapshot endpoints have no controller-level spec of their own yet
— the reconciliation covers everything downstream of "the snapshot answered",
and the guard refusal on those three routes is untested.
