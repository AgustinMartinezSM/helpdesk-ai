# ADR 0022 — Support teams, and why a department is not one

- Status: Accepted (2026-08-03)
- Date: 2026-08-03
- Sprint: 9.12 (Routing)

> The file name says "departments as the routing target" because that is what
> the first draft of this ADR decided. It was wrong, and the correction is the
> substance of this document. The name is left alone so the link from the
> permission matrix and from Sprint 9.12 keeps resolving; renaming a decision
> record to hide that it changed its mind is the opposite of what one is for.

## Context

The approved permission matrix (`docs/architecture/tenancy-target-state.md`)
names three things that do not exist: `teams.manage`, `queues.manage` and
`tickets.read_team`, the last defined as "ticket's queue/team ∈ actor's team
set". There is no team table, no queue table, and no call site for any of them.

What does exist is departments. ADR 0016 gave them a place in the shape —
optional grouping inside a branch, with a `department_memberships` join — and
Sprint 9.11 gave them a product surface. They store rows and nothing keys on
them.

The first draft of this ADR concluded that the department simply _is_ the team
the matrix names, and that `tickets.read_team` should key on department
membership. That would have avoided a new table. **It was the wrong call**, and
the evidence against it is in the repository:

- **`Department.branchId` is a required foreign key.** A department cannot
  exist outside exactly one branch, so it structurally cannot represent one
  central IT team serving every store, one payroll team serving the whole
  organization, or a regional team serving several branches. Those are the
  cases the product has to support.
- **ADR 0016's own examples are requester areas.** Departments appear beside
  operational stations as the internal areas of a store; nothing in the
  repository gives them resolution semantics. There is no place where
  "department" consistently means "the group that fixes this".
- **The matrix lists `teams.*` separately from everything department-shaped**,
  which is a hint the first draft talked itself out of.

Making `Department.branchId` nullable would have been the cheap escape. It is
rejected below for the same reason: it would freeze one word onto two meanings
and buy a semantic migration later.

## Decision

**A department and a support team are different concepts, and the model says
so.**

- **Department** — the requester's organizational area. Branch-scoped, exactly
  as ADR 0016 designed it. Untouched by this ADR.
- **Support team** — the operational group responsible for resolving a ticket.
  New, and organization-owned.

```
organization
├── branches
│   └── departments              (requester's area; unchanged)
└── support_teams                (organization-owned)
    ├── support_team_memberships (membership × team; independent of departments)
    └── support_team_branches    (team × branch; ABSENT means organization-wide)
```

Four properties follow, and each one is a requirement this model exists to
satisfy:

1. **A team is organization-owned**, so one central IT team can serve every
   store and one payroll team can serve the whole organization.
2. **Branch scope is an explicit relationship, not an ownership.** A team with
   no `support_team_branches` rows is organization-wide; a team with rows is
   limited to those branches. A regional team is several rows. A branch-local
   team is one. The same table expresses all four cases without a nullable
   column meaning "sometimes global".
3. **Team membership is independent of department membership.** Being in the
   Electronics department of Store 12 grants nothing about resolving tickets;
   being in the IT team does.
4. **`tickets.read_team` derives from active support-team membership**, and
   from nothing else.

**A ticket carries `assignedTeamId`**, nullable forever. The requester's
department is a separate column the model has room for and this sprint does
not add (see below).

**Assignment is validated against the team's branch scope.** A ticket filed
under branch B cannot be assigned to a team scoped to branch A, and a ticket
with no branch cannot be assigned to a branch-scoped team at all — there is no
branch to prove is in scope. This is what makes "a branch-local team cannot see
unauthorized branches" a property of the data rather than a hope: the team
never receives the ticket, so the visibility leg never has to exclude it.

### What I considered

**Departments as teams** (the first draft). Rejected on the evidence above: it
cannot express a central or regional team, and it would make one word mean the
requester's area in the schema and the resolver group in the permission model.

**`Department.branchId` nullable.** Cheaper, and it would allow an
organization-wide "department". Rejected because it does not resolve the
ambiguity, it hides it: the same table would hold "Electronics at Store 12"
and "Payroll, everywhere", and every later feature would have to ask which
kind of row it was looking at. The master product model treats them as
separate concepts and so does this one.

**A team owning a branch (`support_team.branchId`).** Simpler than a join, and
enough for branch-local teams. Rejected: it cannot express a regional team
serving three of five stores, which is one of the cases the product must
support, and it would force duplicate teams for the same function — the exact
argument ADR 0016 used to reject a `branch_id` column on membership.

**Route to a person instead.** Assignment already exists. Rejected as a
different feature: assignment says who is working it, routing says which group
owns it, and a ticket needs somewhere to sit before anybody picks it up.

**Queues as the routing target.** The matrix names `queues.manage`. Rejected
as undefined: a queue is an ordering and assignment policy over work, and
nothing in the product has one. If queues arrive they will have to say what
they are that a team is not.

## Consequences

Positive:

- The four required shapes — central, organization-wide, regional,
  branch-local — are all expressible, and by the same mechanism.
- `tickets.read_team` gets a call site, which closes a real hole: until now
  `service_desk_manager` and `team_manager` held `tickets.assign_agent` with
  no read beyond their own tickets. They could assign work they could not
  list.
- Departments keep meaning what ADR 0016 said they mean. No semantic migration
  is owed later.
- Team membership and department membership can diverge, which is what
  actually happens: the person who fixes the till is not in Checkout.

Negative / accepted:

- **A new table triple** where the first draft would have added none. The cost
  is real and it is the price of not overloading a word.
- **Two membership joins now exist** (`department_memberships`,
  `support_team_memberships`) and a reader has to know which is which. The
  names carry it, and this ADR is the place that says why.
- **`queues.manage` stays unimplemented**, now clearly deferred rather than
  vaguely pending.
- **The requester's department is not yet on the ticket.** The model has room
  for `requesterDepartmentId` and Sprint 9.12 deliberately does not add it:
  the sprint's job is the team foundation, and a second nullable context
  column with its own picker is a separable increment. Nothing in this ADR
  has to change when it lands.
- **Team scope is enforced at assignment, not at read.** A team narrowed to
  fewer branches after a ticket was assigned keeps seeing that ticket. That is
  deliberate — retroactively hiding assigned work would lose it — and it is
  the one place where "cannot see unauthorized branches" means "was never
  given them" rather than "is filtered out now".

## Related

ADR 0016 (the branch/department/station shape, and what a department is), ADR
0015 (the permission model, and the two-names-one-idea lesson that the first
draft of this ADR nearly repeated), ADR 0014 (the token claims the team set
rides on, and their bounded staleness), ADR 0013 (the organizational graph
lives in one database, which is what makes the new joins enforceable), ADR
0012 (the tenant check that precedes every scope).
