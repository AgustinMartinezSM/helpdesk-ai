# Sprint 9.12 — Routing

Status: **Definition of Ready, open (2026-08-03).** Written and checked before
any code, the pattern the last seven sprints set.

## Definition of Ready

**Previous dependency complete.** Sprint 9.11 is merged with remote CI green
(run `30783298165` on `5cc0036`, first attempt). Branches, departments and
stations are a product surface, and departments are the one part of it that
stores rows and does nothing — which is what this sprint is for. Four code
comments have pointed at 9.12 by name since 9.5.

**The gap is not the one the sprint's name suggests, and reading the code is
what changed my mind.** I expected routing to be about unrouted intake: a
ticket with no branch never reaches a `tickets.read_branch` holder, and 9.5
recorded that as "unrouted intake belongs to the central view until routing
exists". That turns out to be correct behaviour rather than a hole — a ticket
that names no place is not any branch's — and routing does not change it.

The real hole is sharper, and it is in the permission map:

```ts
const DESK_AND_TEAM_MANAGER_PERMISSIONS: ReadonlySet<string> = new Set([
  PERMISSIONS.ORGANIZATION_READ,
  PERMISSIONS.TICKETS_CREATE,
  PERMISSIONS.TICKETS_READ_OWN,
  PERMISSIONS.TICKETS_ASSIGN_SELF,
  PERMISSIONS.TICKETS_REPLY_PUBLIC,
  PERMISSIONS.TICKETS_NOTE_INTERNAL,
  PERMISSIONS.TICKETS_CHANGE_STATUS,
  PERMISSIONS.TICKETS_ASSIGN_AGENT,
]);
```

**`service_desk_manager` and `team_manager` can assign a ticket to somebody
else and cannot list any ticket but their own.** `tickets.assign_agent` with
`tickets.read_own` and nothing wider. The map says so on purpose — their reach
"is team- and queue-shaped in the matrix, and those keys have no feature to
check them yet" — and this sprint is that feature. `tickets.read_team` is a ●
cell for both templates in the approved matrix and has never had a call site.

**What is actually missing, checked file by file:**

- **Departments publish nothing.** `CreateDepartmentUseCase` says why: "no
  consumer exists, and a contract nobody reads is a promise nobody keeps. When
  routing needs departments, that sprint introduces the contract alongside its
  first consumer." That sprint is this one.
- **tickets-service projects `BranchRef` and `StationRef` and no department.**
  Its structure consumer binds four routing keys, all branch and station.
- **The ticket has `branchId` and `operationalStationId`, both nullable, and
  no department column.**
- **There is no `dept` claim.** `ResolveActiveMembership` returns
  `branchIds`; `department_memberships` exists in organizations-service and
  nothing reads it.
- **`tickets.read_team` and `routing.manage` are absent from
  `libs/security`.** Both are ● cells in the matrix.

### Product objective

A ticket goes to the part of the organization that should handle it, and the
people of that part see it in their queue and work it. A service desk manager
stops being somebody who can assign tickets they cannot see.

### User stories and acceptance criteria

1. **A ticket is filed into a department.** The create form offers the
   departments of the branch it is being filed under, and only when that
   branch has more than none (ADR 0016: never ask an organization to configure
   something it does not have). Done when a department of another branch is
   refused, when the field stays optional forever, and when an organization
   with no departments sees no picker and notices nothing.
2. **Somebody can redirect a ticket.** A person holding `routing.manage`
   moves a ticket to another department of its branch, and the move is
   recorded in the ticket's history like every other change. Done when the
   history entry names both departments, and when a department outside the
   ticket's branch is refused.
3. **A desk manager sees their department's work.** Holding
   `tickets.read_team`, they list the tickets routed to the departments they
   belong to, plus their own. Done when a ticket of a department they do not
   belong to is invisible, when their own ticket stays visible wherever it was
   routed, and when the two managers who could assign without reading can now
   read what they assign.
4. **The queue is filterable.** The ticket list can be narrowed to one
   department, intersected with what the caller may see. Done when asking for
   a department outside the caller's set answers the empty page rather than an
   error — the same existence-hiding rule the branch filter follows.

### Technical scope (decisions D1–D9)

- **D1 — The department IS the team the matrix names, and `tickets.read_team`
  keys on it. Recorded in ADR 0022.** The matrix has `teams.manage`,
  `queues.manage` and `read_team`; no team table exists, and
  `department_memberships` is structurally the "team set" the matrix
  describes. Building a parallel team concept beside departments would be two
  overlapping things nobody could tell apart, which is the drift ADR 0015
  spent a sprint undoing for roles. **The cost is named rather than hidden**:
  a department belongs to a branch, so routing is branch-local, and a central
  organization-wide team is not expressible today. What would change that is a
  nullable `branchId` on departments, which is its own decision and not this
  sprint's.
- **D2 — Departments publish their first contract, because their first
  consumer finally exists.** `department.created.v1` and
  `department.updated.v1`, tenant-carrying on the envelope like the branch and
  station pair, consumed by tickets-service into a `department_refs`
  projection. No `deleted` contract: archival is a status, and the update
  carries it.
- **D3 — The ticket gains `department_id`, nullable forever.** Same argument
  the branch column carries: null is a permanently legitimate state, not a
  migration gap. Validated against the local projection at creation,
  fail-closed with one generic 422 covering nonexistent, archived, another
  branch's and another tenant's alike — the discipline the branch and station
  validation already follows.
- **D4 — A department is only valid alongside a branch**, and must belong to
  that branch. The schema says a department has a branch; a ticket routed to
  one but filed under another would be a contradiction the projection cannot
  represent.
- **D5 — The `dept` claim, minted exactly like `br`.** Only when non-empty,
  `Actor.departmentIds` optional, absence denies. The same shape means the
  same reasoning applies without restating it, and `resolve-active-membership`
  gains one repository call beside the branch one.
- **D6 — Redirecting a ticket is `routing.manage`.** The matrix gives it to
  owner, organization_admin and service_desk_manager, which is exactly who
  should be able to move work between departments. This sprint interprets the
  key as "decide where a ticket goes"; automatic rules are the other half it
  will cover, and they are out of scope below.
- **D7 — Agents keep `tickets.read_all`, deliberately.** The matrix gives
  agents `read_team` and not `read_all`, and the map has carried that as a
  marked interim widening since 9.5. Shrinking it here would be a product
  decision wearing a technical commit: in an organization with no departments
  it would leave every agent seeing only their own tickets, which is exactly
  what ADR 0016 forbids asking of an organization that configured nothing. The
  shrink needs a rule for the no-departments case first, and that rule is a
  decision, not an implementation.
- **D8 — The visibility legs stay first-match, widest first.** `read_all`,
  then `read_branch`, then `read_team`, then own. Branch and team scopes are
  incomparable and **no template holds both**, so this is not yet a union
  question; the first template that does is what forces the answer, and the
  code says so where the leg is added.
- **D9 — One migration in tickets-service**: the `department_id` column and
  the `department_refs` table. Nullable, no backfill, no data movement — every
  existing ticket keeps a null department, which is a state the product means
  rather than a gap to fill.

### Security boundaries

- **The tenant is checked before any routing scope.** Step 1 of the resolved
  visibility model is non-negotiable and unchanged: a bug in the new leg can
  only produce an over-broad in-tenant read, never a cross-tenant one.
- **The department filter hides existence.** Asking for a department outside
  the caller's set answers the empty page, never a 4xx and never a widened
  query — the rule the branch filter settled in 9.5.
- **Absence denies.** `read_team` with an empty or absent department set sees
  own tickets only, exactly as `read_branch` does with an empty branch set.
- **Routing changes visibility, so it is a permissioned act.** Moving a ticket
  between departments moves who can see it; that is why it is gated rather
  than treated as an ordinary field edit.
- **No new event payload field on the ticket contracts.** The standing rule
  from 9.5 holds: branch and department context stay off ticket event
  payloads until a consumer needs them, which is a v3 conversation.

### Migration impact

One migration in tickets-service, additive and nullable, plus a new projection
table. Rollback is a `git revert` plus a forward migration dropping the column
if it has to go — the same shape as every additive migration since phase 4.
The projection rebuilds from the event log; departments created before this
sprint publish nothing, so **an organization that already has departments must
have them re-announced**, and the operator script that reconciles the
directory projection is the model for it. That backfill is part of this
sprint, not an afterthought.

### Test strategy

Unit specs beside the use cases for the validation, the visibility leg and the
routing refusals, each named for what it closes: a department of another
branch, of another tenant, an archived one, a routed ticket invisible to
somebody outside its department, and a caller with `read_team` and an empty
set seeing only their own. Contract specs for the two new events. An
integration spec against the real broker and database for the projection, in
the suite that already covers branch and station refs. tickets-service
controller specs for the picker, the route endpoint and the filter. apps/web
specs swap the session fixture's permissions per control.

Full gate plus all nine integration suites before push, then remote CI.

### Explicitly out of scope

**Automatic routing rules** — a table of (branch, category) → department
applied at creation. It is the other half of `routing.manage` and it is the
wrong first increment: rules whose effects nobody can see are unfalsifiable,
and this sprint builds the thing they would act on. Shrinking agents to
`read_team` (D7). Organization-wide departments (D1). Queues as a concept
distinct from departments, and `queues.manage`. Reassigning a ticket's branch
after creation. Department membership as an editable product surface — people
are put in departments through the internal operator path today, which is the
one attribution gap 9.11 did not close and the next one worth naming. i18n.

### Ready?

The dependency is green, and the state is known down to the permission set
that revealed the real gap. The structural decision has its own ADR and it
resolves an ambiguity the matrix has carried since it was drafted rather than
inventing a new concept. There is one migration, additive and nullable, and
the projection backfill it implies is in scope rather than discovered later.
The cut is taken here: no rules, no agent shrink, no org-wide departments, no
queues. Proceeding under the standing autonomous authorization.
