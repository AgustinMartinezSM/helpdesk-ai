# Sprint 9.12 — Support teams

Status: **Definition of Ready, open (2026-08-03).** Written and checked before
any code, the pattern the last seven sprints set.

**This DoR was rewritten after its first draft was wrong.** The first version
decided that routing meant sending a ticket to a department, and that
`tickets.read_team` should key on department membership. The project owner
stopped it, and the repository agrees with them: `Department.branchId` is a
required foreign key, so a department cannot represent one central IT team
serving every store, a payroll team serving the organization, or a regional
team serving several branches. Those are cases the product must support. The
corrected model — support teams as a separate, organization-owned concept — is
in **ADR 0022**, including why making `Department.branchId` nullable was
rejected rather than taken as the cheap escape.

## Definition of Ready

**Previous dependency complete.** Sprint 9.11 is merged with remote CI green
(run `30783298165` on `5cc0036`, first attempt).

**The gap that makes this urgent is in the permission map:**

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
else and cannot list any ticket but their own.** The map says so on purpose —
their reach "is team- and queue-shaped in the matrix, and those keys have no
feature to check them yet" — and this sprint is that feature.

**What is actually missing, checked file by file:**

- **No support team exists anywhere.** Not a table, not a domain type, not a
  key. `teams.manage` and `tickets.read_team` are ● cells in the matrix with
  no call site.
- **The ticket has `branchId` and `operationalStationId`** — both nullable,
  both validated against local projections — **and nothing about who resolves
  it beyond `assigneeId`, a person.**
- **tickets-service projects `BranchRef` and `StationRef`.** Its structure
  consumer binds four routing keys, all branch and station.
- **There is no team claim.** `ResolveActiveMembership` returns `branchIds`
  and nothing else scope-shaped.
- **Departments exist and are the requester's area** (ADR 0016), branch-scoped
  by a required foreign key. This sprint does not touch them.

### Product objective

A ticket is owned by the group responsible for resolving it, and the people of
that group see it. An organization can express the group shape it actually has
— one central IT team, one payroll team, a regional team over three stores, or
a team local to one — without duplicating anything. A service desk manager
stops being somebody who can assign tickets they cannot see.

### User stories and acceptance criteria

1. **An organization defines the support teams it has.** Create a team, name
   it, archive it; give it members; give it a branch scope or leave it
   organization-wide. Done when a team with no scope rows serves every branch,
   when a team with rows serves exactly those, and when both are the same
   mechanism rather than two.
2. **A ticket is assigned to a team.** A holder of `routing.manage` assigns or
   clears it, and the ticket's history records the move like every other
   change. Done when a team of another organization is refused, when a team
   whose branch scope excludes the ticket's branch is refused, and when a
   branch-scoped team cannot take a ticket that has no branch at all.
3. **A team's people see the team's work.** Holding `tickets.read_team`, they
   list tickets assigned to the teams they actively belong to, plus their own.
   Done when the two manager templates that could assign without reading can
   now read what they assign.
4. **Leaving a team ends the access.** Done when removing somebody from a team
   — or suspending their organization membership — leaves them without that
   team's tickets at their next token.
5. **A department grants nothing.** Done when somebody who belongs to a
   department and no team, holding `tickets.read_team`, sees only their own
   tickets.
6. **An organization with no teams notices nothing.** Done when agents keep
   the visibility they have today and no screen asks about a concept the
   organization has not configured (ADR 0016).

### Technical scope (decisions D1–D10)

- **D1 — Support teams are a new, organization-owned concept (ADR 0022).**
  `support_teams`, `support_team_memberships` (membership × team) and
  `support_team_branches` (team × branch). Absence of scope rows means
  organization-wide; presence means exactly those branches. Departments are
  untouched.
- **D2 — Team membership is independent of department membership**, and the
  visibility leg reads only the former. This is the property that makes the
  two concepts safe to keep apart, and it gets its own test.
- **D3 — Three keys, all already in the matrix.** `teams.manage` (create,
  edit, archive, membership, scope) to owner, organization_admin and
  service_desk_manager; `tickets.read_team` to those three plus team_manager,
  agent and auditor, matching the ● cells; `routing.manage` (assign a ticket
  to a team) to owner, organization_admin and service_desk_manager.
  `team_manager`'s ○ on `teams.manage` — their own team only — stays
  unrepresented, the same call the last two sprints made for own-scope cells.
- **D4 — Agents keep `tickets.read_all`.** They gain `read_team` because the
  matrix gives it to them, and it is inert while they hold the wider read.
  Shrinking them is a product decision that needs a rule for organizations
  with no teams, and it is not this sprint's.
- **D5 — The ticket gains `assignedTeamId`, nullable forever.** Same argument
  as `branchId`: null is a permanently legitimate state. Every existing ticket
  keeps null and behaves exactly as it does today, which is acceptance
  criterion 6 and gets a test.
- **D6 — Assignment is validated against a local projection, fail-closed.**
  tickets-service projects `TeamRef` and `TeamBranchRef` from the team events;
  assignment checks the team is in the caller's organization, active, and
  scoped to the ticket's branch. One generic 422 covers nonexistent, archived,
  another branch's and another tenant's alike — the discipline branch and
  station validation already follow.
- **D7 — The `tm` claim, minted exactly like `br`.** Only when non-empty,
  `Actor.teamIds` optional, absence denies. Team membership reaches
  tickets-service through the token rather than a second projection, which is
  the mechanism `br` established; it inherits the same bounded staleness
  (ADR 0014), so leaving a team takes effect at the next mint and the tests
  say so rather than implying it is instant.
- **D8 — The visibility legs stay first-match, widest first**: `read_all`,
  then `read_branch`, then `read_team`, then own. No template holds both
  `read_branch` and `read_team`, so this is not yet a union question; the
  first template that does is what forces the answer, and the code says so
  where the leg is added.
- **D9 — Scope is enforced at assignment, not at read.** A team narrowed after
  a ticket was assigned keeps seeing that ticket. Retroactively hiding
  assigned work would lose it, and the property the requirement asks for —
  a branch-local team cannot see unauthorized branches — holds because the
  ticket was never assignable, not because a filter removes it later.
  ADR 0022 records this explicitly.
- **D10 — No screen this sprint.** The surface is API-complete and tested, at
  the `api-ready` status ADR 0009 exists for. Teams are new, so there is no
  historical data to re-announce and no backfill — the projection starts empty
  and fills from the first event. The Organization screen gains teams in 9.13,
  and building it here would make one sprint that is already three migrations
  and a new claim unreviewable.

### Security boundaries

- **The tenant is checked before any scope.** Step 1 of the resolved
  visibility model is unchanged: a bug in the new leg can only produce an
  over-broad in-tenant read, never a cross-tenant one.
- **A team of another organization is not addressable.** Every lookup is
  organization-scoped at the port, so a foreign team id and a nonexistent one
  answer alike, and assignment refuses both with the same generic message.
- **Absence denies.** `read_team` with an empty or absent team set sees own
  tickets only, exactly as `read_branch` does with an empty branch set.
- **Assignment moves who can see a ticket**, which is why it is permissioned
  rather than an ordinary field edit.
- **No ticket event payload gains a field.** The standing rule from 9.5 holds:
  branch and team context stay off ticket payloads until a consumer needs
  them, which is a v3 conversation.

### Migration impact

Two migrations. organizations-service gains the three team tables;
tickets-service gains `assigned_team_id` plus the two ref tables. All additive
and nullable, no backfill, no data movement. Rollback is a code revert plus a
forward migration, the shape every additive migration has taken since phase 4.

### Test strategy

The eight scenarios the project owner named are the acceptance list, each with
a test that states which one it is: a central team seeing several branches'
tickets; a branch-local team refused a foreign branch's ticket; a department
member granted nothing; a team manager seeing their active teams' tickets; a
removed or suspended member losing the access at the next mint; organization A
unable to reference or assign organization B's team; an organization with no
teams leaving the agent experience unchanged; and existing tickets valid with a
null team after migration.

Beside those: contract specs for the three new events, an integration spec
against the real broker and database for the projection, controller specs for
the team surface and the assignment route, and the visibility leg unit-tested
against the fakes that enforce organization scope for real.

Full gate plus all nine integration suites before push, then remote CI.

### Explicitly out of scope

**Automatic routing rules** — a table of conditions choosing a team. Named out
by the project owner, and the right call: rules whose effects nobody can see
are unfalsifiable, and this sprint builds the thing they would act on.
**`requesterDepartmentId` on the ticket** — the model has room for it and
ADR 0022 does not change when it lands; it is a separable increment with its
own picker. Queues, and `queues.manage`. Shrinking agents to `read_team` (D4).
`team_manager`'s own-scope `teams.manage` (D3). Any screen (D10). i18n.

### Ready?

The model question that would have cost a semantic migration later is resolved
before the first table exists, which is the whole reason a DoR gets written
before code. The eight required scenarios are the acceptance criteria rather
than an afterthought. Two migrations, both additive, no backfill. The cut is
taken here: no rules, no requester department, no queues, no screen.
Proceeding under the standing autonomous authorization.
