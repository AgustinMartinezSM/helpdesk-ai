# ADR 0022 — Departments as the routing target

- Status: Accepted (2026-08-03)
- Date: 2026-08-03
- Sprint: 9.12 (Routing)

## Context

The approved permission matrix (`docs/architecture/tenancy-target-state.md`)
names three things that do not exist: `teams.manage`, `queues.manage` and
`tickets.read_team`, the last defined as "ticket's queue/team ∈ actor's team
set". There is no team table, no queue table, and no call site for any of
them.

What does exist is departments. ADR 0016 gave them a place in the shape —
optional grouping inside a branch — plus a `department_memberships` join, and
Sprint 9.11 gave them a product surface. They store rows and nothing keys on
them; `CreateDepartmentUseCase` has said since 9.5 that their first contract
arrives "alongside its first consumer".

So routing has to answer a question the matrix left open: is the thing a
ticket is routed to a department, or a team, or both?

## Decision

**The department is the routing target, and `tickets.read_team` keys on
department membership.** The matrix's team vocabulary describes a set of
people who share work; `department_memberships` is that set, already modelled,
already administrable.

`teams.manage` therefore resolves to the department management that
`branches.update` already covers (Sprint 9.11, D1), and no separate key is
introduced. `queues.manage` stays unimplemented, because a queue is a
different idea — an ordering and assignment policy over work — and nothing in
the product has one yet.

**`tickets.read_team` becomes a visibility leg**: the tickets of the
departments the actor belongs to, plus their own. The department set rides a
`dept` token claim minted exactly like `br`, and absence denies.

### What I considered

**Build teams as their own table, beside departments.** Faithful to the matrix
word for word, and it would allow a team spanning branches. Rejected: it puts
two overlapping concepts in front of the same user, with no answer to "should
this be a department or a team" that anybody could give without reciting the
schema. That is the drift ADR 0015 spent a sprint undoing for roles — two
names for one idea, kept in sync by hand — and I would rather not re-earn the
lesson.

**Rename departments to teams.** Cheaper than a second table and it matches
the matrix exactly. Rejected: ADR 0016 chose "department" for the retail
scenario the product was designed around, where Electronics and Checkout are
departments of a store and calling them teams would read as a mistake. The
matrix is an internal document; the product's word is the one the user sees.

**Introduce `tickets.read_department` as a new matrix row.** Honest about the
model, and it avoids reinterpreting an approved cell. Rejected: it adds a
seventh visibility key for the same shape as an existing one, and leaves
`read_team` as a permanent orphan nobody dares delete. Reinterpreting the cell
and recording it here is the smaller lie to future readers than two keys with
one meaning.

**Route to a person instead.** Assignment already exists. Rejected as a
different feature: assignment says who is working it, routing says where it
belongs, and a ticket needs somewhere to sit before anybody picks it up.

## Consequences

Positive:

- `tickets.read_team` gets a call site, which closes a real hole: until now
  `service_desk_manager` and `team_manager` held `tickets.assign_agent` and no
  read beyond their own tickets — they could assign work they could not list.
- Departments stop being rows with no behaviour, three sprints after the
  schema made room for them.
- No new concept, no new table, no new vocabulary in front of the user.

Negative / accepted:

- **Routing is branch-local, and that is a real limitation.** A department
  belongs to a branch, so "Networking" as one organization-wide team is not
  expressible; a chain gets one Electronics per store. For the retail scenario
  the product was designed around this is correct — the ticket is about that
  store's Electronics — and for a central IT desk it is not. What would change
  it is a nullable `branchId` on departments, which is its own decision with
  its own migration, and this ADR deliberately does not take it.
- **A ticket with no branch cannot be routed**, because a department needs
  one. Unrouted intake stays with the organization-wide readers, which is what
  it already did.
- **`queues.manage` and the queue idea are now clearly deferred rather than
  vaguely pending.** If queues arrive they will need to say what they are that
  a department is not, and this ADR is where that argument starts.
- **The matrix now has one cell whose meaning lives here rather than in it.**
  `tickets.read_team` reads "team" and means "department". That is a
  documentation debt, paid down by this ADR being linked from the matrix.

## Related

ADR 0016 (the branch/department/station shape, and "never ask an organization
to configure something it does not have"), ADR 0015 (the permission model, and
the two-names-one-idea lesson), ADR 0014 (the token claims routing rides on),
ADR 0012 (the tenant check that precedes every scope).
