# ADR 0016 — Branch and operational station model

- Status: Accepted (approved 2026-07-30)
- Date: 2026-07-30
- Sprint: 9.1 (Product domain and tenancy audit)

## Context

Nothing resembling a branch, location, site, department or workstation exists
anywhere in the codebase. The tickets table has ten columns and the only
identity columns are `requesterId` and `assigneeId`
(`apps/tickets-service/prisma/schema.prisma:32`). Every access decision
reduces to `isStaff(actor) || ticket.requesterId === actor.id`.

So this ADR is pure design rather than migration. The forcing scenario is the
retail chain: a card terminal fails at cashier station 2 in store 12, and a
central support team has to receive it with enough context to act, while a
store manager sees their own store and not the other nineteen.

Two harder requirements sit underneath that:

- Not every organization has branches. A shop with eight employees and one
  owner must not be made to create a branch to file a request.
- Branch computers are shared. The person at the till changes through the
  day, and the product must not answer that with a permanent shared password.

## Decision

### Branches are structural; stations are contextual

This is the distinction the whole design rests on, and I want it stated
before the tables:

**A branch is a scope.** It constrains what a person may see, so it is an
authorization input and it belongs in organizations-service alongside
memberships (ADR 0013).

**An operational station is not a principal.** It never authenticates, never
holds a credential, and never appears as an actor. It is a registered _place_
that supplies context to a request. A ticket records both the human who asked
and the station they asked from, and those are different columns answering
different questions.

Getting this backwards is how shared-terminal designs become
`cashier2@store12` with a password on a sticky note, which is untraceable by
construction: every request from that till is attributed to an account rather
than a person.

### Shape

```
organization
├── branches            (code, name, status, timezone, address)
│   ├── departments     (optional; an organization may use none)
│   └── operational_stations  (code, name, area, responsible manager, status)
└── memberships
    ├── branch_memberships      (membership × branch × scope)
    └── department_memberships  (membership × department)
```

`branch_memberships` is a join table rather than a `branch_id` column on
membership, because a regional manager covers several stores and a central
agent covers all of them. A single column would force duplicate memberships
for the same person in the same organization, which breaks the identity model
in ADR 0013.

### Everything is optional

An organization with no branches has no branch rows, and its tickets carry a
null branch. Visibility then degrades to organization scope, which is exactly
right for the eight-person shop. Departments are independently optional.
Stations are optional even within a branch.

The rule I want enforced in the UI as well as the schema: **an organization
should never be asked to configure something it does not have.** Branch,
department and station selection appear when the organization has more than
one to choose from, and not before.

### Ticket context

Tickets gain `branch_id` and `operational_station_id`, both nullable, both
opaque ids with no foreign key (ADR 0003). `organization_id` is not
derivable from them — a null branch still needs a tenant — so it stays a
separate required column, as ADR 0012 says.

### Shared workstations, without a shared password

The station supplies context; a person still authenticates. The increment I
would build first is the least clever one:

- the workstation is registered to a branch and a station, remembered locally;
- an employee signs in normally on that machine;
- a new request inherits the station context automatically;
- the session is short-lived and ends on inactivity;
- the audit trail records both the operator and the station.

Deliberately **not** in the first increment: kiosk mode, operator PIN
selection, and device-bound credentials. Each is a real credential design with
its own recovery and audit story, and none is needed to make the retail
scenario work. What is forbidden outright, at any increment: a permanent
shared password, an account named after a till, and any flow where a request
cannot be attributed to a person.

## What I am least sure about

Whether `branch_memberships` needs a scope qualifier per row — "manages" vs
"works at" — or whether the role template on the membership is enough. A
branch manager for store 12 who is also a requester at headquarters is
expressible either way, and I do not have enough real usage to choose. I have
modelled a `scope` column and would happily drop it if the first
implementation shows the role template already carries the meaning.

I am also aware that "operational station" is a technical term. The UI should
say _cashier station 2_ or _reception desk_, and the glossary should carry
both — the model does not need the product's vocabulary and the product does
not need the model's.

## Consequences

Positive:

- The retail chain works: a ticket names both the person and the till, and a
  branch manager's visibility is a scope rather than a special case.
- The small company is unaffected — no branches, no departments, no stations,
  nothing to configure.
- Shared terminals get operational convenience without an untraceable
  credential.

Negative / accepted:

- Two more nullable columns on tickets, and two more join tables to keep
  consistent.
- Visibility rules get genuinely more complex: `tickets.read_branch` needs
  the caller's branch set, which is a claim that grows with the number of
  branches a person covers.
- Station context is advisory metadata. Nothing verifies that a request
  claiming station 2 came from station 2 until device registration exists.

## Related

ADR 0013 owns these tables. ADR 0015 defines the branch-scoped permissions.
ADR 0017 covers why a station is never an identity.
