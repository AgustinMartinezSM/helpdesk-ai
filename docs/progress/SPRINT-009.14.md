# Sprint 9.14 — Role template and permission scope vocabulary

Status: **Implemented and verified locally (2026-08-03).** The Definition of
Ready below was written and checked against the repository before any code; the
outcome record at the end says what landed against it.

## Definition of Ready

**Previous dependency complete.** Sprint 9.13 is merged with remote CI green
(run `30788005358` on `ec065aa`). `main` equals `origin/main` at `f0275cf`,
working tree clean. A focused browser smoke test over the 9.13 routing surface
ran before this sprint was opened and passed all seven steps; what it found is
in "The finding that belongs here" below.

**Why this before bulk import.** CSV import assigns memberships and role
templates at scale. Every ambiguity in the vocabulary becomes a row it writes,
and a wrong grant made a thousand times is not a thousand small mistakes — it
is one unreviewable one. The vocabulary is also the oldest open question in the
repository: it has blocked ADR 0015's seeded template rows since Sprint 9.4 and
has been named in every handoff since.

### What is actually inconsistent, checked file by file

**Four spellings of the same eight things.**

| Where                                    | Convention                        | Count |
| ---------------------------------------- | --------------------------------- | ----- |
| ADR 0015 prose                           | `organization admin` (lowercase)  | 8     |
| `tenancy-target-state.md` role table     | `ORGANIZATION_ADMIN` (SCREAMING)  | **9** |
| `tenancy-target-state.md` matrix columns | `ORG_ADMIN` (abbreviated)         | 8     |
| `domain/membership.ts` `ROLE_TEMPLATES`  | `organization_admin` (snake_case) | 8     |

The target-state document says "**Eight** templates" in the sentence directly
above a table with **nine rows** — the ninth being `PLATFORM_SUPER_ADMIN`. That
is not a typo to fix quietly; it is the platform/organization scope distinction
having no home, which is exactly what required case 4 is about.

**`PLATFORM_SUPER_ADMIN` exists in two documents and no code.** ADR 0015 makes
it an invariant ("a CSV import, a directory group or an organization admin must
never be able to produce a `PLATFORM_SUPER_ADMIN`"), and today that invariant
holds **by absence**: `GRANTABLE_ROLE_TEMPLATES` is `ROLE_TEMPLATES` minus
`owner`, and `ROLE_TEMPLATES` happens to contain nothing platform-scoped.
Absence is not an invariant. Adding a platform template later would make it
grantable silently, and the sprint that adds it is the one least likely to
check.

**The `○` own-scope qualifier is on 17 cells, not the twelve every document
says.** The matrix has grown three sprints without the count being revisited,
so the number quoted in ADR 0015's amendment and in the handoff is stale.
Seventeen cells is not a pending representation problem — it is a notation used
for at least three different meanings that nobody has separated.

**The invitable-template list is duplicated, and the two copies agree by
coincidence.** `apps/web/src/lib/people.ts` hardcodes
`INVITABLE_ROLE_TEMPLATES` (seven entries); the server derives
`GRANTABLE_ROLE_TEMPLATES` from `ROLE_TEMPLATES`. They match today because both
are "everything except `owner`". Neither imports the other, and the real
ceiling is per-actor anyway — an agent-template holder is offered seven role
choices in the invite form and would be refused all seven.

**`service_desk_manager` holds flat `people.read`, granted one sprint ago by
me.** Sprint 9.13 needed a member picker for the support-team editor, the
matrix grants that template `people.read` as `○` (own scope), own scope had no
representation, so the flat key went in **marked as an interim widening**. It
is the third such widening in the map and the newest. Reviewing it is required
case 2 and is named in this sprint's brief.

**Display names already diverge from keys, in one place, pinned by nothing.**
`roleLabel` in the browser maps `agent` → "Technician" and `requester` →
"Employee". That is the right instinct (ADR 0016: the product's vocabulary and
the model's may differ) living in the wrong layer, with no test and no
relationship to the key list.

### The finding that belongs here, and does not reopen 9.13

The pre-sprint smoke test confirmed all seven required steps. It also
reproduced this, deliberately, after clearing a ticket's routing:

> Selecting **IT support** in the ticket list's "Filter by support team" still
> returns a ticket that is routed to **no team at all**.

This is not a leak and not a 9.13 regression. `ListTicketsUseCase` builds
`teamScope: { teamIds, requesterId: actor.id }`, which the repository turns
into `assignedTeamId IN (…) OR requesterId = me`. The OR-own leg is the
**visibility rule**, deliberate and documented since Sprint 9.5 for the branch
scope ("the OR-own leg is the visibility rule, not a filter, so it survives the
branch narrowing"), and carried to the team scope by 9.12's D8. The server is
behaving exactly as designed, and it only ever adds tickets the caller could
already see.

What is wrong is the **word**. Sprint 9.13 put a control labelled _filter_ on
top of a _visibility union_, so the interface promises a narrowing it does not
perform. That is a scope-vocabulary defect, which is this sprint's subject, and
fixing it here rather than reopening 9.13 keeps the correction next to the
decision that explains it.

### Product objective

One vocabulary for roles and scopes, used identically by the backend, the
permission matrix, the API contracts and the interface. A reader can answer
"who may do this, and over what" from any one of them and get the same answer.
Privilege cannot escalate through any grant path — invitation, role change, or
the CSV import that does not exist yet.

### User stories and acceptance criteria

The eight required cases, each with the test that will state which one it is:

1. **An organization admin can assign allowed organization roles.** Done when
   the templates offered are the ones the server would accept for _that actor_,
   and the offered list and the accepted list come from the same place.
2. **A service desk manager finds team candidates without administrative
   access.** Done when they can staff a support team by name and cannot read
   the directory's administrative columns or reach the People screen.
3. **A team manager cannot browse or manage people.** Done when they hold
   neither directory key and every people route refuses them.
4. **An invitation cannot grant platform-level privileges.** Done when
   grantability is derived from a template's declared scope, so a
   platform-scoped template is refused by construction rather than by not
   existing — with a test that adds one and watches it be refused.
5. **A future CSV import cannot grant forbidden roles.** Done when the same
   single derivation answers for import as for invitation, so there is nothing
   for the import sprint to re-decide.
6. **Display names are localizable without touching keys.** Done when the
   stable key and the human label are separate values, every key has a label,
   and a test fails if a template is added without one.
7. **Existing memberships keep equivalent access.** Done when no stored
   `role_template` value changes and no migration runs — **with one deliberate
   exception, stated in D4 and not hidden**: `service_desk_manager` loses flat
   `people.read`. That grant is one sprint old, was marked interim when made,
   and this is the sprint named as where it shrinks.
8. **Suspended and deactivated memberships stay ineffective.** Done when
   resolution still refuses them and a test says so against the new vocabulary
   rather than assuming the old behavior survived.

### Technical scope (decisions D1–D10)

- **D1 — The stable internal key is the snake_case value already stored.**
  `owner`, `organization_admin`, `branch_manager`, `service_desk_manager`,
  `team_manager`, `agent`, `requester`, `auditor`. Every document adopts it.
  **Rejected: renaming to `SCREAMING_SNAKE`** to match the target-state table —
  that is a data migration of `role_template` on every membership and every
  invitation row, plus the backfill script's mapping, in exchange for a
  cosmetic. The documents move to the code, not the code to the documents,
  because only one of them is load-bearing.
- **D2 — The template vocabulary joins `libs/security`, next to `PERMISSIONS`
  and under the same rule.** Keys and scopes only; the template → permission
  map stays in organizations-service, because ADR 0013 puts the evaluator
  there. This is the split `PERMISSIONS` already has and it is what lets the
  browser stop re-declaring its own list. The `/permissions` entry point stays
  import-free.
- **D3 — Every template declares a scope, and grantability derives from it.**
  `organization` for the eight; the type admits `platform`, and
  `GRANTABLE_ROLE_TEMPLATES` becomes "scope is `organization`, and not
  `owner`". `PLATFORM_SUPER_ADMIN` is **not added** — an unused template would
  break the same rule `PERMISSIONS` follows, that only keys with a real call
  site exist. What lands instead is the derivation plus a test that constructs
  a platform-scoped template and asserts it is refused by invitation and by
  role change. The invariant stops depending on nobody adding a row.
- **D4 — `people.read_assignable`, and `service_desk_manager` trades down to
  it.** A new key with a genuinely narrower answer: **active members only**,
  and a projection of `userId`, display name and email — **no phone, no role
  template, no status, no profile values**. Email stays because the picker uses
  it to tell two people with the same name apart, and pretending otherwise
  would make the narrowing sound bigger than it is. The reduction that matters
  is the other one: without `people.read` that template no longer reaches the
  People screen, `GET /users/:userId`, or anyone's administrative columns.
  Served by `GET /users/assignable`, declared **before `@Get(':userId')`** —
  the route-order rule this repository has been bitten by twice.
- **D5 — `○` is resolved by classification, not by representation.** ADR 0015
  already decided that scope lives in the key ("a scope argument is a thing a
  call site can forget to pass and a permission key is not"), so `○` will never
  be something the evaluator represents. Each of the 17 cells becomes one of
  three, marked in the matrix: **(a)** already a distinct key
  (`tickets.read_own` beside `read_branch`/`read_team`/`read_all`); **(b)**
  domain logic and not a grantable key (a requester closing their own resolved
  ticket); **(c)** deferred, and named with the feature that would check it.
  The count is corrected to 17 wherever twelve is quoted.
- **D6 — One per-actor source for "which roles may I hand out".**
  `GET /organizations/role-templates` returns the templates the **caller** may
  grant, derived from their stored membership through the existing ceiling. The
  hardcoded array in `apps/web/src/lib/people.ts` is deleted. The invite form
  and the role editor then offer exactly what the server accepts, which also
  removes a class of refusal that only appeared on submit.
- **D7 — Display names are separated from keys and completeness is pinned.**
  The label map keeps living in the browser (it is presentation), but it is
  keyed off the shared vocabulary so a template added server-side without a
  label is a test failure rather than a raw key leaking into the interface.
  **No i18n framework** — case 6 asks that localization be possible without
  changing keys, and separation is what makes it possible.
- **D8 — The ticket list's team control stops promising a narrowing it does
  not perform.** The server is unchanged: the OR-own leg is deliberate (9.5,
  9.12 D8) and removing it would hide a manager's own request from them. The
  interface changes to describe what it does. A spec pins the wording against
  the behavior so the two cannot drift again.
- **D9 — Seeded template rows stay out, and this sprint says why with an end
  in sight.** Settling the vocabulary is what unblocks them; turning the code
  map into rows is a migration, a repository and an evaluator change, and it is
  a mechanism sprint rather than a vocabulary one. ADR 0015's amendment gets
  the honest update: the blocker was the vocabulary, the vocabulary is settled
  here, and seeding is now a separable increment nobody is waiting on.
- **D10 — No CSV import.** Not a line of it. This sprint exists so that sprint
  has one derivation to call and nothing to re-decide.

### Security boundaries

- **Privilege still cannot travel upward.** The two ceilings from ADR 0021 are
  untouched: the requested template and the target's current template must both
  be grantable by the actor, read from the **stored** membership, and `owner`
  is refused in both directions by constant. This sprint adds the scope
  derivation _above_ them, and removes nothing.
- **Platform scope becomes structural.** Required case 4 stops being satisfied
  by an empty set and starts being satisfied by a rule with a test.
- **The narrowing is real and is the point.** `service_desk_manager` ends this
  sprint able to do strictly less than they can today. Nothing else changes
  reach.
- **`people.read_assignable` is a read of active members only**, so a suspended
  person cannot be quietly staffed onto a team — which is the same reason the
  directory's default has stayed active-only since 9.10.
- **Client gates still only decide what to render** (ADR 0015 rule 2 / ADR
  0020). D6 makes the rendered list match the server's answer; it does not move
  the decision.

### Migration impact

**No data migration.** No stored `role_template` value changes, no table gains
a column, no backfill runs. Rollback is a code revert. The only behavior change
to an existing membership is D4's deliberate narrowing, which is a permission
map edit and reverses by editing it back.

### Test strategy

The eight required cases, each named in its test. Beside them: the derivation
refusing a constructed platform-scoped template; the ceiling unchanged for
every existing pair; `people.read_assignable` returning active members only and
refusing a `team_manager`; the People screen and `GET /users/:userId` refusing
a desk manager; label completeness over the shared key list; and the ticket
list's team control asserted against what the query actually returns.

Full gate plus all nine integration suites before push, then remote CI. A
browser pass over the invite form and the team member picker, since D4 and D6
both change what a real screen offers.

### Explicitly out of scope

CSV import (D10). Custom per-tenant roles — the existing architecture does not
require them for correctness, and ADR 0015 already says templates cover every
scenario in the brief. Seeded template rows (D9). An i18n framework (D7).
Queues. Automatic routing rules. Branding, the Helpi redesign, billing,
WhatsApp, SSO and SCIM.

### Ready?

The oldest open question in the repository, and the one that would have been
most expensive to answer _after_ an import wrote a thousand memberships against
it. No data migration, one deliberate narrowing that was scheduled when it was
made, and an invariant that stops depending on a row nobody has added yet.
Proceeding under the standing autonomous authorization.

## Outcome record (2026-08-03)

Two commits: the opening (`c0e14e5`) and the implementation (`7bfe35f`), plus
the documentation below.

**The oldest open question in the repository is closed.** ADR 0015's amendment
deferred seeded template rows on a stated blocker in Sprint 9.4 — four
conventions for the templates, a platform-scoped ninth with nowhere to live,
and an own-scope qualifier nothing could represent. All three are answered, and
one of them was worse than recorded: the qualifier was on **seventeen** cells
across twelve rows, not the twelve every document quoted, because the matrix
grew for three sprints without the count being revisited.

**Nothing was renamed and nothing migrated.** The stable keys are the
snake_case values already in `memberships.role_template`. Matching the
target-state document's `SCREAMING_SNAKE` instead would have been a data
migration of every membership and invitation row, plus the backfill script's
mapping, in exchange for a cosmetic. The documents moved to the code, because
only one of them is load-bearing — required case 7, satisfied by not needing to
be satisfied.

**ADR 0015's platform invariant stopped being an accident.** It says no
organization may ever produce a platform super admin, and it held because
`GRANTABLE_ROLE_TEMPLATES` was "everything except `owner`" and nothing
platform-scoped existed. That is absence, not an invariant: the sprint that
finally adds a platform template is the one least likely to remember. Templates
now declare a scope and grantability derives from it, with a test that builds a
platform-scoped template the way a future sprint would and watches it be
refused. No such template ships — a key with no call site is a claim nothing can
falsify, the same rule the permission vocabulary follows.

### What the implementation decided that the DoR had left open

- **The answer to the desk manager's directory access was a narrower KEY, not
  a narrower scope.** `people.read_assignable` returns active members as
  `userId`, name and email, and nothing else — no phone, no role template, no
  status, no profile values, no single-member read, and no People screen. Email
  stayed because a picker needs to tell two people with the same name apart;
  claiming otherwise would have oversold the narrowing.
- **The narrowing could have made `service_desk_manager` ungrantable by
  anybody, and nearly did.** The ceiling compares permission sets, so giving a
  template a key the granter's own set does not literally contain is exactly
  what `tickets.read_branch` did in Sprint 9.10 — after which nobody could
  create a branch manager through any surface. `people.read` now implies
  `people.read_assignable` in `IMPLIED_PERMISSIONS`, which is the line that
  table's warning comment was written for. It has now been needed twice.
- **`GET /organizations/memberships/role-templates` is per actor, and that
  fixed a defect nobody had filed.** The browser hardcoded seven templates and
  offered them to everyone, including people whose own template could grant
  none of them — the refusal arrived on submit, after typing an email address.
  The list now comes from the same two functions the write path checks, applied
  to the same stored membership.
- **The `○` classification did not need a new mechanism.** ADR 0015 had already
  decided that scope lives in the key; what was missing was applying it. Each
  cell is now marked (a) already a distinct key, (b) domain logic, or (c)
  deferred with the feature that would check it — and a deferred cell is simply
  a permission a seeded row would express as absence.

### Verified

Full workspace gate green: format, lint, typecheck, test and build across all
15 projects. organizations-service 271 tests (25 new), users-service 71 (11
new), web-bff 44 (3 new), apps/web 190 (9 new). All nine integration suites
green against real PostgreSQL and RabbitMQ.

**The narrowing was verified in a browser and then across real processes.** In
the browser, signed in as the `service_desk_manager` whose template this sprint
changed: the **People entry is gone from the navigation** — the clearest thing
the narrowing does, since that link is gated on `people.read` — the Organization
screen still renders branches and support teams, and the team panel requests
`/people/assignable` rather than `/people`.

The responses were then confirmed through the full chain (browser client →
web-bff → api-gateway → users-service / organizations-service), with tokens
carrying exactly the permission sets the map now resolves:

| Request                      | Token                  | Result                                   |
| ---------------------------- | ---------------------- | ---------------------------------------- |
| `GET /people/assignable`     | `service_desk_manager` | **200**, rows of `{userId, name, email}` |
| `GET /people`                | `service_desk_manager` | **403** — required case 2                |
| `GET /people/assignable`     | `team_manager`         | **403** — required case 3                |
| `GET /people`                | `team_manager`         | **403** — required case 3                |
| `GET /people/role-templates` | `organization_admin`   | seven templates, no `owner` — cases 1, 4 |
| `GET /people/role-templates` | `service_desk_manager` | `[]` — grants no roles                   |

Two ceilings on the browser pass, both recorded rather than implied. The
five-preview limit bit again — auth-service and users-service cannot both run
alongside web, web-bff, api-gateway and organizations-service — so the team
picker's populated state was not seen rendered; its response was verified over
HTTP instead, and the spec suite covers the rendering. And `form_input` set
input values without React registering them on this run, so the login form had
to be driven with real keystrokes; a first submit that raced a starting
auth-service left the page's `submitting` flag stuck, which looks exactly like
a dead button and is worth knowing before diagnosing one.

**A browser smoke test over the Sprint 9.13 routing surface ran BEFORE this
sprint opened** and passed all seven required steps, over six real processes as
a `service_desk_manager`: a ticket opened, routed to a support team
(`PATCH /tickets/:id/team` → 200, `assigned_team_id` set in the database, a
`routed to support team …` history row), the team name rendered after the
backend confirmed it, the ticket list narrowed by team, the routed ticket
present, and the routing cleared with the interface following the backend both
ways. It also reproduced the labelling defect this sprint fixed. The
tickets-service projection was empty on this machine because its durable queue
had never existed when 9.12's events were published; archiving and reopening
the team through the product emitted the events that filled it, which is the
cold-start path 9.12's D10 described and is now known to work.

### Still true after this sprint

Seeded template rows: unblocked, unbuilt, and now a mechanism task. No custom
per-tenant roles — the architecture does not need them for correctness. No CSV
import. The agent template keeps `tickets.read_all`, `tickets.assign_agent` and
a flat `people.read`; those are the last three interim widenings and the
`people.read` one is now the last of its shape. `queues.manage` stays
unimplemented on purpose. Twelve `○` cells remain in class (c) — deferred, each
named with the feature that would check it, and none of them blocking anything.

## Documentation

Meaningfully changed this sprint: `tenancy-target-state.md` — the role-template
table rewritten to the stable keys with a scope column that means grant
authority rather than reach, its "eight templates above nine rows"
contradiction resolved, the `○` notation classified cell by cell, and the
document's own intro corrected where it still named the vocabulary as blocking
seeded rows; ADR 0015, which gains an amendment closing the blocker its
previous amendment opened and corrects the twelve-cell count to seventeen; the
permission vocabulary's own comments, where the new key explains what it does
not answer; and this document.

Historical sprint documents were left alone. ADR 0015's original amendment
keeps its wrong count in place with the correction directly beneath it, for the
reason ADR 0022 keeps its misleading filename: a decision record that edits
away what it used to believe is worth less than one that shows the change.

No fictional experience, customer, incident, deployment or approval was
introduced.
