# Sprint 9.5 — Branches, departments and operational stations

Status: **Implemented and verified locally (2026-07-31).** The Definition of
Ready below was written and checked before any code; the outcome record at
the end says what landed against it.

## Definition of Ready

**Previous dependency complete.** The tenancy migration (phases 0–8) is
merged on `main` with remote CI green (`25fed90` at the time of writing).
Every organization-owned read requires a tenant, writes take it from the
token, authorization is permission-based, and the membership lifecycle
publishes events. This sprint builds on all five.

**Real state known.** Nothing resembling a branch, department or station
exists in any schema. tickets has no context columns beyond requester and
assignee. organizations-service owns `organizations` and `memberships` only.
ADR 0016 (accepted, Sprint 9.1) already designed the model this sprint
implements; ADR 0013 already decided the tables live in
organizations-service.

### Product objective

A company with one location files requests exactly as today — nothing new to
configure. A retail chain can register its stores and tills, a request can
say "cashier station 2 in store 12", a store manager sees their store and
not the other nineteen, and a central team sees everything.

### User stories and acceptance criteria

1. **Org admin registers structure** (internal operator surface this
   sprint): create/update/archive branches, departments under a branch,
   stations under a branch; assign a member to branches; change a member's
   role template. Done when each operation exists, is guarded, publishes its
   event where a consumer needs one, and is idempotent-safe under replay.
2. **Requester files a located request**: ticket creation accepts optional
   `branchId` and `stationId`; an unknown, archived or foreign branch is
   refused (422) without revealing whether it exists elsewhere; a station
   must belong to the ticket's branch; a ticket with neither is exactly
   today's ticket. Done when the validations are tested with two
   organizations.
3. **Branch-limited visibility**: a member whose template grants
   `tickets.read_branch` and whose membership covers branch B sees, in list
   and detail, tickets of B plus their own — and not tickets of branch C nor
   of other organizations. `tickets.read_all` remains organization-wide.
   Done when the two-organization, three-branch matrix is pinned by tests at
   the use-case and repository levels.
4. **Central manager receives from allowed branches**: an org admin lists
   organization-wide and can filter by branch. Done when the list filter
   works and is tested.
5. **Pickers exist for clients**: an authenticated member can list their
   organization's active branches (and a branch's active stations) to fill a
   create-ticket form. Done when the endpoint is tenant-scoped and tested.

### Technical scope (and the decisions it rests on)

Decisions D1–D6, each reversible, each recorded where it belongs when
implemented:

- **D1 — Structure lives in organizations-service** (ADR 0013/0016, already
  decided): `branches`, `departments`, `operational_stations`,
  `branch_memberships`, `department_memberships`, real FKs inside the one
  database. Internal, service-token-guarded endpoints are the operator
  surface until the people-management sprint builds the real one — the same
  pattern the membership status PATCH set.
- **D2 — The branch set travels in the token**, as ADR 0016's consequences
  section already accepted: resolution returns the active membership's
  branch ids and auth mints them as a `br` claim next to `perms`; read paths
  stay token-only (ADR 0014's boundary is untouched). `Actor` gains an
  OPTIONAL `branchIds` — absent denies branch-scoped visibility, the safe
  direction — because it has exactly one consumer today and the
  required-field churn is not yet paying for anything.
- **D3 — `branch_memberships` ships WITHOUT the scope qualifier column**
  ADR 0016 was unsure about. The role template carries the meaning
  (branch_manager × branch set = manages; agent/requester × branch set =
  works at). This is precisely the experiment the ADR asked for; its
  amendment records the outcome. It also dissolves part of the pending
  scope-qualifier question: `tickets.read_branch` + a branch set IS the
  own-scope cell, representable without new vocabulary.
- **D4 — tickets-service validates branch context against a local
  projection**, not a synchronous call: `branch.created/updated.v1` and
  `station.created/updated.v1` (born tenant-carrying) project into
  `branch_refs`/`station_refs`. Ticket creation is a hot path, so ADR 0014's
  mutations-may-ask exception does not apply; eventual consistency means a
  just-created branch may be refused for a moment, and fail-closed is the
  right direction. tickets-service gains its first consumer.
- **D5 — Ticket event payloads do not change.** No consumer needs the branch
  yet (branch analytics is Sprint 11.5), and adding fields to a published
  payload is the mutation ADR 0005 forbids — when a consumer needs it, that
  is a v3. The branch lives on the ticket row and in API responses.
- **D6 — organizations-service stays off the gateway and keeps no JWT.**
  The pickers clients need are served by tickets-service from its own
  projection (`GET /tickets/branches`, gated on `tickets.create` — you need
  the picker to file a request; the admin-facing `branches.*` permission
  keys arrive with the admin surface in 9.8). Giving organizations-service a
  public face is a real structural change that belongs to the sprint that
  needs it.

Also in scope: `membership.role-changed.v1` (the retail scenario needs a
branch manager to exist, so the internal surface can change a template;
version bump, event, users-service directory projection consumes it),
`tickets.read_branch` joins the permission vocabulary with a real call site,
and the branch_manager template gains it.

### Security boundaries

- Branch ids are authorization inputs (they widen visibility), so they are
  validated server-side against the projection and never trusted from the
  browser beyond "this id exists, is active, and is mine".
- A foreign or guessed branch id at creation answers the same 422 as a
  nonexistent one — confirming existence is the leak.
- Stations are context, never principals (ADR 0016): no credential, no
  actor, nothing verifies provenance yet, and that is documented as
  advisory.
- The internal endpoints inherit the INTERNAL_SERVICE_TOKEN posture,
  including its known rotation/audit gap.
- Adversarial tests: branch of org B on a ticket of org A; branch manager of
  B reading A; station of branch X on a ticket of branch Y; archived branch
  at creation; empty branch set with read_branch.

### Migration impact

All additive: five new tables in organizations-service; two nullable columns
plus two projection tables and one index in tickets-service. No backfill —
existing tickets legitimately have no branch. No NOT NULL anywhere. Rollback
is a code revert plus dropping empty tables.

### Test strategy

Unit at every gate and use case (fakes enforcing scope for real, per R2's
lesson); integration per service against real Postgres/RabbitMQ — the
structure round-trip (create branch → event → tickets projection → validated
creation → branch-scoped list) is the retail scenario's technical proof;
two-organization fixtures throughout; the full gate plus all nine suites
before push.

### Explicitly out of scope

Kiosk/PIN/device registration (9.7); people-management and org-admin UI and
the public organizations surface (9.8 / Block B); CSV import (9.9); routing
and assignment rules by branch (9.11); branch analytics (11.5); department
_behavior_ (rows and memberships exist per ADR 0016's shape, but nothing
keys on them yet — routing will); seeded role-template rows (vocabulary
question still open); any web UI (Block B owns the product surface).

### Ready?

Every checklist item of the working agreement holds: dependency complete,
state known, criteria above, architecture/migration/security understood,
strategy written, scope one coherent sprint. The structural decisions above
either implement an accepted ADR or conserve an existing boundary; none is
destructive or hard to reverse. Proceeding under the standing autonomous
authorization, with each decision recorded in its owning document as it
lands.

## Outcome record (2026-07-31)

Every acceptance criterion landed, in four commits: the structure and its
events (`b061d86`), the `br` claim (`0c74dd7`), role changes in the
directory (`e5f044d`), and ticket context with branch-scoped visibility
(`a1c0877`).

**The retail scenario holds end to end at the API level.** A branch and a
till exist as rows with real foreign keys; a request can name both; the
projection-backed validation refuses nonexistent, archived and foreign
branches with one indistinguishable 422; a branch manager's list shows their
store plus their own requests and never the neighbor store, the unrouted
intake, or another organization — pinned by identity against the real SQL
with the same requester planted across branches and organizations; and an
org admin filters organization-wide by branch.

### What the implementation decided that the DoR had left open

- **An archive is an update.** One `branch.updated.v1` covers rename, status
  and timezone changes: consumers project last-write state, not a
  lifecycle, so a second contract would have added nothing but a second
  binding.
- **A branchless ticket is invisible to branch managers on purpose.**
  Unrouted intake belongs to the central view until routing (9.11) exists —
  the alternative silently turns every branch manager into a triage queue.
- **The list's branch-visibility OR is one filter field (`branchScope`),
  not two composable optionals**, because either half alone means something
  narrower or wider than the visibility rule, and a call site should not be
  able to assemble the wrong sentence from correct words.
- **Archived branches stay in the resolved branch set.** A manager keeps
  seeing the history of a store that closed; archiving hides the branch
  from pickers, not from accountability.
- **The status vocabulary stays unfrozen strings end to end**, with one
  pinned word (`active`) that the projections key on — renaming statuses in
  organizations-service is one edit in tickets-service, not a contract
  change.

### Deviations from the DoR

None of substance. ADR 0016's amendment records the D3 outcome (the scope
qualifier column was dropped before it existed, and the role template does
carry the meaning). Department behavior remains schema-plus-endpoints with
no events and nothing keying on rows, exactly as scoped out.

### Verified

Unit suites green across the four touched projects (organizations 149,
tickets 78, users 23, auth 42, messaging 62), including the DoR's
adversarial matrix verbatim. Integration against real PostgreSQL and
RabbitMQ: the structure events reach a queue with the tenant on the
envelope, a role change resolves to the new template's permissions,
branch memberships round-trip into `branchIds`, the tickets migration
applied to a populated database, the branch-visibility predicate and the
projection scoping pinned by identity at the SQL level, and the LWW guard
proven unable to resurrect an archived branch from a replay. The full gate
and all nine integration suites, plus the remote CI result, are recorded in
the handoff as usual.

## Documentation

Meaningfully changed this sprint: this document (the first sprint opened
with a written Definition of Ready — worth keeping as the pattern), ADR
0016's amendment settling its own open question, and the handoff. No
fictional experience, customers, incidents or approvals were introduced.
