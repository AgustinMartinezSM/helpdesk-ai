# Sprint 9.11 — Organization setup

Status: **Definition of Ready, open (2026-08-03).** Written and checked before
any code, the pattern the last six sprints set.

**This sprint takes the number 9.11, which four code comments had reserved for
routing.** Those comments now say 9.12, changed in the opening commit rather
than left to rot: a reserved number that no longer means what it says is worse
than a renumbering, because the next person to read `ticket-queries.ts` would
believe it. Routing itself is unchanged and still comes after this.

## Definition of Ready

**Previous dependency complete.** Sprint 9.10 is merged with remote CI green
(run `30780847286` on `5d1534b`, first attempt). Member administration works
end to end, and its branch editor is the consumer that proves this sprint's
shape: an administrator can already give somebody the branches they manage —
they just cannot create one.

**The gap, and why it is the sharpest one left.** After 9.10 there is exactly
one category of write in the product that no person can be attributed for, and
it is the whole organizational structure. `InternalOrganizationStructureController`
still creates and edits branches, departments and stations behind
`INTERNAL_SERVICE_TOKEN`, with its own comment saying what it is:

> The operator surface for organizational structure (Sprint 9.5, D1) —
> internal and service-token-guarded like the membership lifecycle PATCH, and
> for the same reason: the real admin surface arrives with the
> people-management sprint.

The people-management sprint arrived and took the membership half. This is the
other half of the same sentence. **When it lands, `INTERNAL_SERVICE_TOKEN`
stops guarding any mutation at all** — what is left behind it is two read-only
membership lookups, which changes SECURITY.md's paragraph again and is worth
saying out loud rather than discovering later.

There is also a plainer consequence: **a new organization cannot be made usable
without a database client.** 9.10 already made the first administrator a SQL
step; if their branches are one too, the product cannot onboard anybody from
inside itself.

**What is actually missing, checked file by file:**

- **Two permission keys.** `branches.create` and `branches.update` are ● for
  owner and organization_admin in the approved matrix (with `branches.update`
  also ○ for branch_manager) and appear nowhere in `libs/security`.
  `branches.read` and `branches.manage_members` landed in 9.10.
- **No public endpoint, and no listing for two of the three entities.**
  `BranchRepository.list` arrived in 9.10 for the branch picker;
  `DepartmentRepository` and `OperationalStationRepository` have `create`,
  `findByOrganizationAndId` and `update` and nothing that enumerates.
- **The six structure use cases take no actor**, exactly as the two membership
  ones did before 9.10, and for the same reason.
- **The station's responsible manager is addressed by MEMBERSHIP id.**
  `CreateStationDto.responsibleMembershipId` is an internal key of
  organizations-service; nothing the browser can reach ever returns one. The
  People screen deals in `userId`, and so does every public membership route
  9.10 added.
- **The authenticated shell has two hardcoded nav links**, Tickets and People,
  the second gated on `people.read || people.invite`.

**What already works and must keep working.** Archival is real behaviour
downstream, not a flag: tickets-service projects branch and station refs from
`branch.created/updated.v1` and `station.created/updated.v1`, keys its lookups
on `active`, and answers one generic 422 for "nonexistent, archived or another
tenant's" alike. Departments publish nothing and nothing consumes them — by
scope, since routing is what will key on them.

### Product objective

An administrator opens Organization, registers the branches their company
actually has, gives each one its departments and its service points, and marks
what closed as archived. Every one of those is attributable to the person who
did it. When they are done, a new organization is usable — people can be
invited into it, given the branches they manage, and file tickets naming a real
place — without anybody touching the database.

### User stories and acceptance criteria

1. **An administrator registers a branch.** Code, name, optional timezone and
   address; the code is unique within the organization and immutable
   afterwards. Done when the branch appears in the People screen's branch
   editor without any other step, and when a duplicate code answers 409 rather
   than creating a second row.
2. **An administrator corrects a branch and archives one that closed.** Name,
   timezone and address are editable; the code is not. Done when archiving
   removes the branch from ticket creation's picker while leaving it visible to
   the people who covered it (the property 9.5 built and 9.10 preserved), and
   when un-archiving restores it exactly as it was.
3. **A branch gets its departments.** Create and rename, unique by name within
   the branch, archivable. Done when a department of another branch with the
   same name is accepted, and when nothing keys on departments yet — this
   sprint stores them and says so.
4. **A branch gets its service points.** Create with a code and name, an
   optional area, and an optional responsible person chosen **by who they are,
   not by an internal id**. Done when the responsible person is named with a
   `userId` the People screen also uses, when a person of another organization
   is refused, and when removing that person from the organization leaves the
   station standing.
5. **The operator surface is gone.** Done when the six internal structure
   routes answer 404 with the service credential present, and when
   `INTERNAL_SERVICE_TOKEN` guards no mutation anywhere in the platform.
6. **What the UI shows matches what the server allows.** Creating is gated on
   `branches.create`, editing on `branches.update`, and seeing on
   `branches.read`; a stale-permission 403 renders as a real message (ADR 0020).

### Technical scope (decisions D1–D9)

- **D1 — Two keys, and departments and stations get none of their own.**
  `branches.create` gates creating a branch. `branches.update` gates
  everything else about a branch and everything about its children — renaming
  it, archiving it, adding a department, registering a station. The matrix has
  no rows for departments or stations because they are not scopes; they are
  contents of one, and a key per child would be inventing vocabulary the
  matrix never approved. Both keys go to `owner` and `organization_admin`
  only. **`branches.update`'s ○ for branch_manager stays unrepresented**, the
  same call 9.10 made for `branches.manage_members`: own-scope has no
  representation in a flat string set, and inventing one here would quietly
  answer the scope-qualifier question ADR 0016 closed as an experiment.
- **D2 — The structure use cases gain an `Actor`**, exactly as the membership
  pair did in 9.10 (ADR 0015 rule 1: the refusal lives in the use case). No
  wrapper layer — once the operator routes go, each has one caller. The
  organization comes from `requireOrganization(actor)` and stops being a path
  parameter, which removes a whole class of mistake: there is no longer a
  request in which the caller names a tenant.
- **D3 — The public surface speaks `userId`, never `membershipId`.** A
  station's responsible manager is named by the same identifier the People
  screen shows, and the use case resolves it to a membership of the actor's
  organization. The internal shape was defensible for an operator holding a
  database; it is not an interface. The resolution refuses a foreign or absent
  membership with the not-found the station routes already use.
- **D4 — Archival is the delete, and it does not cascade.** `branch.ts`
  already argues why places are archived rather than deactivated ("a place is
  not an access grant"), and this sprint does not touch that. What it decides
  is the open question underneath: archiving a branch leaves its departments
  and stations exactly as they are. Cascading would be destructive in a way
  un-archiving could not undo — it would have to guess which children were
  already archived before. The branch's own status is enough, because
  tickets-service refuses an archived branch at the branch lookup, so nothing
  under it is reachable through it. The screen says so rather than hiding it.
- **D5 — Two listings arrive; the third already did.** `DepartmentRepository`
  and `OperationalStationRepository` gain a `list` scoped by organization and
  branch, including archived rows for the same reason the branch listing does
  (Sprint 9.10, D8): a management screen that cannot see what it archived
  cannot un-archive it. The read is gated on `branches.read`.
- **D6 — No deletes, and no `DELETE` verb anywhere.** Every operation is a
  POST or a PATCH, which is also what keeps the whole surface reachable
  through `GatewayClient` (GET/POST/PATCH only) without touching it — the same
  constraint that shaped 9.8's revoke and 9.10's branch replace.
- **D7 — The events are unchanged.** `branch.created.v1`,
  `branch.updated.v1`, `station.created.v1` and `station.updated.v1` already
  exist, already carry the tenant on the envelope, and tickets-service already
  consumes them. Departments still publish nothing: no consumer exists, and a
  contract nobody reads is a promise nobody keeps. Adding a department event
  belongs to routing, which is what will first care.
- **D8 — One screen, one nav entry, nested by branch.** `/organization` lists
  branches; selecting one reveals its departments and its stations. Not three
  screens — the entities are meaningless apart, and a department list without
  its branch is a list of names. The nav gains a third entry gated on
  `branches.read`, and the two hardcoded links become the array 9.9's record
  said they already were.
- **D9 — The internal structure controller is deleted, not deprecated.** Same
  argument as 9.10, and this time it finishes the job: after it,
  `INTERNAL_SERVICE_TOKEN` opens two read-only lookups and nothing else.
  Nothing in the repository calls the six routes — the integration specs drive
  the use cases directly, and the one controller spec that exercises them moves
  to the public surface with its assertions intact.

### Security boundaries

- **Every write reads the tenant from the token.** Removing `:organizationId`
  from the path is the point, not a tidy-up: an operator surface could be
  trusted to name a tenant, and a browser cannot.
- **Client gates stay cosmetic** (ADR 0015 rule 2, ADR 0020). The three
  controls hide on the keys their use cases check.
- **Refusal shapes follow the existing split**, which the structure use cases
  already implement: an unknown id and another organization's answer the same
  404, a duplicate code answers 409, and the caller's own standing answers 403.
- **A station is context, never a principal** (ADR 0016/0017). Registering one
  creates no credential and no actor; naming a responsible person records who
  answers for the place, not who acts as it. Nothing in this sprint may make a
  station something a request can authenticate as.
- **No new anonymous surface, and one credential-guarded path removed.**

### Migration impact

None. Branches, departments and stations have existed with these columns since
9.5; the two new keys are code, and the listings are queries. Rollback is a
code revert — with the same caveat 9.10 had: reverting after a person has
created a branch through the product leaves a row the old operator surface
would have created identically, so nothing is left inconsistent.

### Test strategy

Unit specs beside the use cases for the actor rules and the `userId`
resolution, each named for what it closes: a caller without the key, a
station whose responsible person belongs to another organization, a duplicate
code, an immutable branch code, and archiving that leaves children alone.
Controller specs for the public routes and their status codes, and for the six
internal routes now answering 404 with the credential present. An integration
spec for the listings against real PostgreSQL, because scoping is where a
wrong `where` leaks a tenant. web-bff gets the pass-through treatment,
asserting both hops and that no policy was added. apps/web specs swap the
session fixture's permissions per control, and cover the branch → department →
station walk.

Full gate plus all nine integration suites before push, then remote CI.

### Explicitly out of scope

Renaming the organization itself, and anything about its identity: the slug is
what the bootstrap lookup keys on and immutability there is its own decision.
Deleting any structure row. Department membership as a product surface —
`department_memberships` exists and nothing keys on it until routing. Routing
itself (9.12). Branch-scoped administration for branch managers (D1's ○).
Bulk/CSV import. Email delivery (ADR 0008, still the project owner's call).
Seeded role-template rows.

### Ready?

The dependency is green, the state is known down to which repository methods
exist and which identifier the station route wrongly speaks, and the one
genuinely open question — what archiving a branch does to its children — is
decided above with its argument rather than left for the implementation. There
is no migration. The scope is smaller than 9.10: three entities that already
exist, two keys, one screen, and a controller deleted. Proceeding under the
standing autonomous authorization.
