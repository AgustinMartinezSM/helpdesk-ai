# Sprint 9.13 — Support teams and routing, in the interface

Status: **Open (2026-08-03).** The Definition of Ready below was written and
checked against the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 9.12 is merged with remote CI green
(run `30785560179` on `f6a2600`, first attempt). `main` equals `origin/main` at
`a7bca8f`, working tree clean.

**The gap is the one 9.12 named for itself.** Its D10 says so in writing: "No
screen this sprint. The surface is API-complete and tested, at the `api-ready`
status ADR 0009 exists for. [...] The Organization screen gains teams in 9.13."
So a support team exists today only for whoever calls the API with a bearer
token. Nobody can create one, staff it, scope it or route a ticket to it
through the product.

### The one thing not to get wrong

**A support team is not a department, and this sprint touches nothing about
departments.** ADR 0022 is the record: a department is the requester's
organizational area and belongs to exactly one branch; a support team is the
group that resolves a ticket, is organization-owned, and reaches branches
through the explicit `support_team_branches` join where **no rows means
organization-wide**. `tickets.read_team` derives from active support-team
membership and from nothing else. The interface has to carry that distinction
rather than blur it — the Organization screen will show both words on the same
page, which is exactly where a careless label would teach the wrong model.

### What is actually missing, checked file by file

- **No teams client, no teams screen.** `apps/web/src/lib` has `organization.ts`
  (branches, departments, stations) and no team anything;
  `apps/web/src/app/(app)/organization/` is `page.tsx` + `branch-panel.tsx`.
- **The BFF has no door to any of it.** `apps/web-bff/.../organization.controller.ts`
  forwards seven branch/department/station paths and nothing under
  `/api/organizations/teams`; `tickets.controller.ts` has no `:id/team` route.
- **The ticket list's team filter is unreachable over HTTP.**
  `ListTicketsUseCase` honours `assignedTeamId` (9.12), but
  `ListTicketsQueryDto` has no such property and both services run
  `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })` — so
  `GET /tickets?assignedTeamId=…` answers **400 today**. A supported input with
  no way in is worse than an unsupported one, because the use case looks
  covered.
- **A `read_team` holder cannot learn their own teams' names.**
  `GET /organizations/teams` is gated on `teams.manage`, which `team_manager`,
  `agent` and `auditor` do not hold. They receive `assignedTeamId` on every
  ticket and have nothing to turn it into a name.
- **`service_desk_manager` cannot see branches or people.** The code map
  (`apps/organizations-service/src/domain/permissions.ts`) gives them
  `teams.manage` and `routing.manage` but neither `branches.read` nor
  `people.read`, so the two editors this sprint builds — branch coverage and
  team membership — would render for them with nothing to choose from.
- **The browser's `Ticket` type stops at `assigneeId`.** `apps/web/src/lib/tickets.ts`
  does not declare `branchId` or `assignedTeamId`, although the service has
  returned both since 9.5 and 9.12.

Everything below the HTTP boundary is done and stays done: the three tables,
the projection, the `tm` claim, the visibility leg, the assignment validation
and the sixteen tests behind them. **This sprint adds no domain rule.** It is
the surface, plus the four small server-side gaps that surface exposes.

### Product objective

An organization can run its support teams from the product: see them, create
them, decide whether a team serves everywhere or only certain branches, put
people in it, and send a ticket to the team that should resolve it. The people
in a team see the team's work without asking anybody for a token.

### User stories and acceptance criteria

1. **A support manager sets up the teams the organization has.** List, create,
   rename, archive and reopen. Done when the list shows archived teams (a
   screen that cannot see them cannot reopen them), when the code is presented
   as immutable _before_ it is chosen rather than after, and when somebody
   without `teams.manage` sees the section not at all.
2. **A team serves the whole organization, or named branches.** Done when a new
   team is shown as organization-wide without anybody choosing that, when
   clearing every branch returns it to organization-wide rather than to
   "serves nothing", and when the screen says which of the two it is in words.
3. **A team has people, and they are picked by name.** Done when members are
   chosen from the directory, when saving replaces the whole set, and when the
   screen says out loud that team membership is separate from any department.
4. **A ticket is routed to a team.** Done when a `routing.manage` holder can
   pick from the organization's active teams and clear the routing again, when
   a refusal (archived team, branch out of scope, no branch at all) renders as
   the server's message instead of a silent failure, and when the ticket's
   history shows the move.
5. **A team's people see the team's work.** Done when a `tickets.read_team`
   holder lists their teams' tickets, can narrow to one of their teams, and
   sees the team's name rather than a UUID.
6. **A department grants nothing, and the interface says so.** Done when the
   teams section contains no department control of any kind, and when the copy
   distinguishes the two concepts where they meet.
7. **An organization with no teams notices nothing.** Done when an empty teams
   list renders as an invitation to create the first one, when no ticket screen
   asks about routing for somebody without `routing.manage`, and when the
   existing ticket flows are unchanged for everybody else (ADR 0016).

### Technical scope (decisions D1–D10)

- **D1 — Teams live on the Organization screen, as a section beside branches.**
  Not a fourth navigation entry. Teams are organization-owned setup, which is
  what that screen is; a separate entry would also have to explain itself to
  the many templates that hold no team key. The page gate widens from
  `branches.read` to `branches.read || teams.manage`, and each section carries
  its own key — the People screen's pattern since 9.9, where listing
  invitations and reading the directory are separately gated.
- **D2 — `service_desk_manager` gains `branches.read` and `people.read`.** The
  first is a matrix ● cell finally getting a call site: the branch-coverage
  editor cannot name a branch it may not read. The second is a **marked interim
  widening**, the third in the map and the same shape as the agent's: the
  matrix gives the desk manager `people.read` as ○ (own scope), own scope still
  has no representation in a flat set of strings, and a member picker
  fundamentally needs the whole directory — it exists to add somebody who is
  not in the team yet. Both are recorded in the file with why, and the second
  shrinks when the scope-qualifier vocabulary lands.
- **D3 — One new route: `GET /organizations/teams/mine`, with no permission
  key.** It returns the teams the caller actively belongs to, read through the
  same `listActiveTeamIdsForMembership` the `tm` claim is minted from — so the
  two can never disagree about archived teams. No key for the reason
  `PATCH /users/me` has none: it exposes nothing the caller's own token does
  not already carry, and it is what turns the `tm` ids into names. It answers
  an empty list for somebody in no team, and needs a tenant like every other
  read.
- **D4 — The routing picker reads `GET /organizations/teams`, not a new
  endpoint.** Every template holding `routing.manage` also holds `teams.manage`
  (owner, organization_admin, service_desk_manager), so the administration
  listing already serves the picker. That is a premise, not a coincidence, so a
  **test pins it** — the same discipline 9.8 used for the `owner`-resolves-like-
  `organization_admin` premise, so it speaks up when it stops being true.
- **D5 — `assignedTeamId` joins `ListTicketsQueryDto`.** Closing the dead path
  above. The use case already intersects it with the caller's team set and
  answers the empty page for a team outside it, so the DTO is the whole change;
  a controller spec pins that the parameter now reaches the use case.
- **D6 — The BFF forwards, and decides nothing.** Five team paths under
  `/organization/teams*` and `PATCH /tickets/:id/team`, plus `branchId` and
  `assignedTeamId` on the ticket list's query. Refusals pass through with their
  status and message intact, including the generic 422 that covers archived,
  foreign-tenant and out-of-scope teams alike — rewriting it in the BFF would
  turn one deliberate answer into three.
- **D7 — The browser learns `branchId` and `assignedTeamId` on a ticket.** Both
  have been in the response for sprints; the type simply never said so.
- **D8 — Client gates decide what to render, never what to allow.** ADR 0015
  rule 2 / ADR 0020, unchanged: `can(session, …)` on `teams.manage`,
  `routing.manage`, `tickets.read_team`, and every refused call rendering the
  server's message, because the permission snapshot goes stale with the token.
- **D9 — No migration, no event, no contract.** Every table exists. Team
  membership still reaches tickets-service through the `tm` claim and no
  contract, and no ticket event payload gains a field — that stays a v3
  conversation (standing rule since 9.5).
- **D10 — No automatic routing rules.** Named out by the project owner in 9.12
  and still the right call. This sprint makes manual routing usable, which is
  the thing rules would have to act on.

### Security boundaries

- **The tenant comes from the token everywhere.** No new route takes an
  organization id, the rule 9.11 established for the whole public surface.
- **`/teams/mine` cannot widen anybody.** It reads the caller's own membership
  and returns teams they already carry in `tm`. It grants no ticket visibility
  by itself: `canView` still keys on `read_team` plus the claim.
- **Hiding is not authorizing.** Every control this sprint renders has a
  refusal in a use case behind it. The two widened grants in D2 are server-side
  changes to the permission map, reviewed as such — not client gates.
- **The generic refusals stay generic.** One 422 for every reason a team cannot
  take a ticket; a 404 that means both "no such team" and "not yours". The
  interface renders them as they arrive.
- **No invitation code, token or membership id reaches the new screens.** Team
  members are named by `userId`, the identifier the public surface already
  speaks.

### Migration impact

None. The three team tables and the two ref tables were applied in 9.12 to both
the dev and `_test` databases. Rollback for this sprint is a code revert with
no data consequence at all.

### Test strategy

- organizations-service: use-case specs for `/teams/mine` (own teams only,
  archived excluded, empty for a person in no team, tenant required), and the
  D4 premise test that every `routing.manage` template also holds
  `teams.manage`.
- tickets-service: controller spec that `?assignedTeamId=` reaches the use case
  rather than 400-ing, and that a team outside the caller's set still answers
  the empty page.
- web-bff: controller specs for the new forwards, including that an upstream
  422 arrives unchanged.
- apps/web: specs for the teams section (rendered only with `teams.manage`,
  organization-wide vs branch-scoped copy, no department control anywhere in
  it), the routing control (rendered only with `routing.manage`, refusal
  rendered as a message), and the team filter on the ticket list.
- Full gate (format, lint, typecheck, test, build) plus all nine integration
  suites against real PostgreSQL and RabbitMQ before push, then remote CI.

`apps/web/specs` is still type-checked by nothing (a known hole, recorded in
the handoff); specs added here inherit that limitation rather than fixing it,
and it is not this sprint's to close.

### Explicitly out of scope

Automatic routing rules (D10). Queues and `queues.manage`. Shrinking agents to
`read_team` (9.12 D4 — still a product decision needing a rule for
organizations with no teams). `team_manager`'s own-scope `teams.manage`.
`requesterDepartmentId` on the ticket. Bulk/CSV import, email delivery (ADR
0008 — the project owner's decision), the template vocabulary, transfer of
ownership, branding, the Helpi redesign, internationalization, WhatsApp,
billing, SSO and SCIM.

### Ready?

The domain is done and this is the surface over it, which is the smallest
useful increment available. The four server-side gaps are all small, all found
by reading the code rather than assumed, and two of them (the 400 on a
supported filter, the desk manager who can administer teams but see neither
branches nor people) are defects the API-only sprint could not have noticed.
No migration, no event, no contract. Proceeding under the standing autonomous
authorization.
