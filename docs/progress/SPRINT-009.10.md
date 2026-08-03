# Sprint 9.10 — Member administration

Status: **Definition of Ready, open (2026-08-02).** Written and checked before
any code, the pattern the last five sprints set. The outcome record at the end
gets written against it when the work lands.

The number is 9.10 rather than 10.0 on purpose: 9.11 is already reserved for
routing in four places in the code (`create-department.ts`, `ticket.ts`,
`ticket-queries.ts`, `branch-context.spec.ts`), and renumbering around this
sprint would make those references lie.

## Definition of Ready

**Previous dependency complete.** Sprint 9.9 is merged with remote CI green
(`a235c4c`, run `30776256636`, first attempt). The People screen exists, the
session carries permissions rather than role names (ADR 0020), invitations
work end to end, and the membership lifecycle — status transitions, role
changes, the `mv` bump, the events — has existed since the tenancy migration.

**The gap is not "no code". It is "no attributable caller".** Every mechanic
this sprint needs is already written and tested. `ChangeMembershipStatusUseCase`
and `ChangeMembershipRoleUseCase` own the transition table, the atomic version
bump and the events. What they do not have is an actor: both take a plain
`{ organizationId, userId }` input and are reachable only through
`InternalOrganizationMembershipsController`, which is guarded by a shared
process credential. Its own comment says what it is:

> PATCH is the operator surface for suspend/reactivate/deactivate until the
> people-management sprint builds the real one, with a person's token and an
> audit trail behind it.

This is that sprint. So the work is not "build membership management" — it is
"give it a person, and delete the path that has none".

**What is actually missing, checked file by file:**

- **No permission key.** `people.suspend` and `people.assign_roles` are ● for
  owner and organization_admin in the approved matrix
  (`tenancy-target-state.md:145-146`) and appear nowhere in
  `libs/security/src/lib/permissions.ts`. Same for `branches.read` and
  `branches.manage_members`.
- **No public endpoint.** organizations-service's public face is
  `organizations/invitations` and nothing else (ADR 0019).
- **The directory cannot see a suspended person.** `list(organizationId)`
  filters `status: 'active'` in SQL, and `DirectoryEntry` carries no status —
  both with comments deferring to "the people-management sprint". Suspending
  somebody through today's operator endpoint makes them vanish from the only
  screen that could bring them back.
- **`deactivated` is terminal and there is no way around it.** The transition
  table has no edge out, and `membership.ts` defers the reinstatement question
  to this sprint while claiming "a new membership can always be created
  deliberately". That claim is false: `@@unique([organizationId, userId])`
  means there is no second row to create, and redemption inserts with
  `createMany({ skipDuplicates: true })`, so a deactivated person who accepts a
  fresh invitation gets `membershipCreated: false` and stays deactivated. Today
  removal is permanent, silently.
- **A defect the ceiling has been carrying since 9.8.**
  `canGrantRoleTemplate` compares resolved permission SETS. `branch_manager`
  holds `tickets.read_branch`; `organization_admin` and `owner` hold
  `tickets.read_all` instead, and deliberately not `read_branch` — a spec pins
  that (`organization-use-cases.spec.ts:176-186`). So the subset test fails and
  **nobody can invite a branch manager**, while `lib/people.ts` offers "Branch
  manager" in the shipped invite dropdown and the refusal arrives as a 403.
  Every other template an admin can name passes. I found this while designing
  the role-assignment path, which runs the same ceiling; the sprint fixes it
  because the sprint owns that ceiling now.

### Product objective

An admin opens People and can act on the people already there, not only on the
ones they are inviting: change what someone's role is, put a membership on hold
and take it off hold, remove somebody who left, and give a branch manager the
branches they manage. Every one of those is attributable to the person who did
it, and the interim operator endpoints that were none of those things are
deleted in the same commit.

### User stories and acceptance criteria

1. **An admin changes a colleague's role.** The member row offers the
   templates the admin may actually grant; choosing one and confirming moves
   the membership and bumps its version. Done when the ceiling refuses upward
   moves read from the STORED membership rather than the token, when
   `organization_admin` can name `branch_manager` (the defect above, pinned by
   a test that fails before the fix), and when the person's next token carries
   the new permissions.
2. **An admin suspends and reinstates.** Suspension is reversible and reads as
   a state, not a deletion; a suspended member stays visible in the directory
   with their status shown. Done when suspending does not remove the row from
   the screen, when reactivating restores access, and when the directory's
   default listing — the one every other caller uses — still means active only.
3. **An admin removes someone who left.** Removal deactivates the membership;
   it never deletes the row, because the row is what the audit trail and the
   directory projection are built from. Done when a removed person loses access
   at their next token, when the act is confirmed before it fires, and when
   reinstating them later is possible and attributed rather than impossible.
4. **An admin assigns a branch manager to their branches.** The member row can
   open a branch editor listing the organization's branches, with the current
   set checked; saving replaces the set. Done when the person's next token
   carries the new `br` claim, when a branch of another organization is refused,
   and when the internal PUT/DELETE that used to do this no longer exists.
5. **Nobody can quietly promote themselves or unseat the owner.** Done when
   acting on your own membership is refused whatever you hold, when `owner` can
   be neither granted nor targeted, and when each rule has a test that states
   which attack it closes.
6. **What the UI shows matches what the server allows.** Controls are gated on
   `people.assign_roles`, `people.suspend` and `branches.manage_members`
   individually — not on one "can administer" boolean — and a stale-permission
   403 renders as a real message (ADR 0020). Done when swapping the session
   fixture's permissions changes exactly the controls that key governs.

### Technical scope (decisions D1–D10)

- **D1 — Four permission keys arrive, each with a call site in this sprint.**
  `people.suspend`, `people.assign_roles`, `branches.read`,
  `branches.manage_members`. `permissions.ts` says only keys with a real
  server-side call site belong in it, and all four get one here. Granted to
  `owner` and `organization_admin` only. The matrix gives `branches.read` more
  widely and `branches.manage_members` ○ to `branch_manager`; both stay
  unrepresented for now, the same way `people.invite`'s ○ cell has since 9.8 —
  a branch-scoped grant needs to mean "within my branches", and the endpoint
  that would enforce that is not built. Narrower than the matrix is a safe
  place to be; wider is not.
- **D2 — The existing use cases gain an actor instead of being wrapped.**
  `ChangeMembershipRoleUseCase` and `ChangeMembershipStatusUseCase` take an
  `Actor` and do their own authorization, exactly like
  `IssueInvitationUseCase` (ADR 0015 rule 1: the refusal lives in the use
  case). I considered a thin authorizing layer delegating to the existing
  classes, and rejected it: once the operator routes are gone each has exactly
  one caller, so the layer would be indirection with nothing behind it. The
  mechanics — transition table, atomic version bump, events — are untouched.
- **D3 — Two ceilings, not one, and the second is why `owner` is a constant.**
  The REQUESTED template must be grantable by the actor's stored template
  (reusing `canGrantRoleTemplate`), and so must the TARGET's current one:
  without that, an admin could demote anyone at all, including the owner.
  `owner` and `organization_admin` resolve to the same permission set, so the
  subset test is blind to exactly that case — the same blindness
  `INVITABLE_ROLE_TEMPLATES` was invented for in 9.8. So `owner` is excluded by
  constant, as a target as well as a grant: two mechanisms, because one of them
  is currently blind. Transfer of ownership is a decision this sprint does not
  make, and refusing is the reversible half of it.
- **D4 — The grant ceiling learns that `read_all` implies `read_branch`.** The
  fix for the defect above. A small explicit implication table expands the
  issuer's effective reach before the subset comparison, and is used by the
  ceiling ONLY — services keep checking the literal key, and the table must
  never become an authorization shortcut. I chose this over granting
  `tickets.read_branch` to admins: that would contradict a deliberate design
  statement and its spec, to work around a comparison that is simply wrong. The
  same problem returns with `tickets.read_team`, and this is where it gets
  answered once.
- **D5 — Acting on your own membership is refused, whatever you hold.** Not a
  UI nicety: it is what keeps an organization from losing its last
  administrator. Because the actor can never be the target, and the actor must
  be an active member holding the key, at least one active administrator always
  survives any sequence of these operations — no "last admin" counting query,
  which would be a race anyway. Demoting yourself is also unrecoverable by
  construction: you lose the key that would undo it.
- **D6 — Removal is `deactivated`, and deactivation stops being terminal.**
  Two decisions, and the second reverses a documented default, so it gets
  argued. `membership.ts` chose "no way back" because reactivation would
  "restore access silently" through an operator endpoint nobody could be blamed
  for, and it named a fallback — create a new membership — that the unique
  constraint makes impossible. Both premises die in this sprint: the act now
  requires a person's token, a permission key, a confirmation and an event, and
  the fallback never existed. So `deactivated → active` becomes a legal edge and
  a rehire is one attributed click. Deleting the row stays out of the question:
  the directory projection and the audit trail are built from it.
- **D7 — The directory gains a status filter, defaulting to active.**
  `GET /users?status=active|suspended|deactivated|invited|all`, default
  `active`, and `DirectoryEntry` gains `status`. Default-active is the whole
  point: the listing feeds pickers as well as this screen, and silently adding
  suspended people to an assignee picker would be a regression dressed as a
  feature. Only the People screen asks for `all`. This is the increment 9.9's
  outcome record said the status column was waiting for.
- **D8 — Branch assignment is a replace, not two verbs.**
  `PATCH /organizations/memberships/:userId/branches` with the full desired
  `{ branchIds }`, diffed server-side against the current set. One round trip,
  idempotent, and it matches a checkbox editor exactly. It also fits the
  transport: `GatewayClient` speaks GET/POST/PATCH only, which is why 9.8 chose
  POST for revoke, and a PUT-per-branch surface would have needed a new verb
  plus N requests to express one intent. Every id is validated against the
  caller's organization before anything is written — a membership of org A
  covering a branch of org B is precisely the widening this table exists to
  prevent.
- **D9 — The interim operator mutations are deleted, not deprecated.** The
  status PATCH, the role PATCH and the branch PUT/DELETE leave
  `InternalOrganizationMembershipsController`. Nothing in the repository calls
  them (checked: tickets-service's `HttpMembershipVerifier` uses the GET, and
  auth-service uses the sibling resolution controller — both reads, both stay).
  Leaving them behind a deprecation note would leave an unattributable write
  path live, which is the thing ADR 0016 forbids and the thing this sprint
  exists to close. `INTERNAL_SERVICE_TOKEN` keeps guarding real mutations
  afterwards — branch, department and station creation — so nothing about its
  handling changes.
- **D10 — Five routes, one new controller, one new small one.**
  `organizations/memberships` gets the role PATCH, the status PATCH, the branch
  PATCH and a branch GET (the editor's current set, fetched when it opens
  rather than N+1 on page load); `organizations/branches` gets a list for the
  picker, gated on `branches.read`. Both behind `JwtAccessGuard` as plain
  providers, per-controller, exactly as the invitations controller does — the
  `/internal/*` controllers keep their own guard and nothing existing changes
  meaning. web-bff forwards all five as thin pass-throughs with no policy.

### Security boundaries

- **Every rule reads the stored membership, never the token.** The actor's
  template, their standing, and the target's template all come from rows. A
  token outlives a demotion by `JWT_ACCESS_TTL_SECONDS` (900) and nothing
  compares `mv`; 9.8 settled this for invitations and the argument is identical
  here, with a sharper edge — an invitation grants membership, a role change
  grants it retroactively to somebody already inside.
- **Client gates stay cosmetic (ADR 0015 rule 2, ADR 0020).** The three new
  controls hide on the keys their use cases check; the refusals exist
  server-side and a UI test never counts as an authorization test.
- **Refusal shapes follow the existing split.** A membership in another
  organization answers 404 exactly as it does today — `MembershipNotFoundError`
  is built scoped and the filter maps it to Not Found, so this surface cannot
  be used to probe which user ids belong where. A refusal about the CALLER'S
  own standing answers 403 and says why, because it hides nothing they do not
  already know.
- **The version bump is the revocation.** Suspension does not invalidate an
  outstanding access token; the person keeps their permissions until it
  expires, bounded by the same 900 seconds. That is the existing accepted
  staleness (ADR 0014) and this sprint does not narrow it — it only makes more
  people able to trigger it. Named here so the outcome record cannot imply
  suspension is immediate.
- **No new anonymous surface, and no new credential.** Everything added sits
  behind the access guard, and the sprint removes a credential-guarded write
  path rather than adding one.

### Migration impact

None. No schema change in any service: memberships, branch memberships and
branches all exist with the columns this needs, and the transition table is
code. Rollback is a code revert — with one caveat worth stating plainly:
reverting after somebody has been reinstated leaves a membership in a state the
old transition table has no edge to, which is harmless (the row is `active`)
but would refuse a second reinstatement. Nothing to migrate, something to know.

### Test strategy

Unit specs beside the use cases for every rule in D3–D6, each named for the
attack it closes rather than the branch it covers: self-targeting, the owner as
target, the owner as grant, upward grants from a stale token, the target
ceiling, the terminal-status edge that is no longer terminal, and the
`read_all`/`read_branch` implication — that last one written to fail against
today's code first. Controller specs for the five routes and their refusal
codes. An integration spec for the branch replace against real PostgreSQL,
because the diff is where a wrong `where` clause silently widens someone's
visibility. users-service gets the status-filter cases, including the one that
matters most: the default is still active-only. web-bff gets the pass-through
treatment already used for people and invitations, asserting both hops and that
the BFF decides nothing. apps/web specs swap the session fixture's permissions
per control, and cover the stale-403 message.

Full gate — format, lint, typecheck, test, build — plus all nine integration
suites against real PostgreSQL and RabbitMQ before push, then remote CI.

### Explicitly out of scope

Creating, renaming and archiving branches, departments and stations: those stay
on the internal operator surface, because `branches.create` / `branches.update`
are a setup story, not an onboarding one, and this sprint's claim is only that
no ONBOARDING step is unattributable. Transfer of ownership (D3 refuses instead
of deciding). Departments and stations per member — nothing keys on department
membership yet, and a station is context, never a principal (ADR 0016).
Bulk/CSV import, still waiting behind this. Per-person pages, directory search,
filtering, sorting and pagination — `GET /users` offers none and adding them is
its own backend work. Profile field editing, unchanged from 9.9's cut. Seeded
role-template rows: the vocabulary question is still open and this sprint adds
no seed. Email delivery (ADR 0008, the project owner's call). i18n.

### Ready?

The dependency is green, the state is known down to the SQL and the two
comments that deferred decisions to this sprint by name, and both of those
decisions are made above with their arguments rather than left to discover
during implementation. One live defect is documented with the test that will
prove it. Everything is additive except the deleted operator routes, which
nothing calls; there is no migration. The scope is smaller than 9.9 and the
cuts are taken here rather than in the middle: no branch CRUD, no ownership
transfer, no import. Proceeding under the standing autonomous authorization.
