# ADR 0015 — Permission model

- Status: Accepted (approved 2026-07-30)
- Date: 2026-07-30
- Sprint: 9.1 (Product domain and tenancy audit)

## Context

The platform's entire authorization vocabulary today is two boolean
predicates over a flat array of strings:

```ts
// libs/security/src/lib/actor.ts:7-20
export interface Actor {
  readonly id: string;
  readonly roles: string[];
}
export function isStaff(actor: Actor): boolean {
  return actor.roles.includes('agent') || actor.roles.includes('admin');
}
export function isAdmin(actor: Actor): boolean {
  return actor.roles.includes('admin');
}
```

There are eleven role checks in the whole platform, each a single boolean
with no resource scope. Every one currently answers _"may this person do this
anywhere"_, and every one has to become _"may this person do this here"_.

Four findings shape the decision:

**Roles are global and unscoped.** `roles String[]` sits on the user row
(`apps/auth-service/prisma/schema.prisma:22`). There is no role table, no
membership table, no scope column.

**There is no way to change a role through the product.**
`PrismaUserRepository` exposes `findByEmail`, `findById` and `create` — and no
`update`. A repo-wide grep confirms nothing writes `roles` after
`User.create`. Roles are changed today by direct SQL, and the public site
says so out loud: _"assigned outside the product — there is no administration
UI"_ (`apps/web/src/app/(public)/how-it-works/page.tsx:207`).

**`isStaff` is defined four times.** The shared copy in `libs/security`, plus
byte-identical local copies in `apps/tickets-service/src/domain/ticket.ts:65`
and `apps/users-service/src/domain/user-profile.ts:30`, plus a fourth
hand-rolled inline in `apps/web/src/app/(app)/tickets/[id]/page.tsx:81`. The
library's own header comment concedes the duplication and calls the migration
pending.

**`admin` is never distinguished from `agent` inside tickets-service.** The
only role split anywhere in the ticket domain is staff / not-staff. `isAdmin`
is called in exactly one place in the entire platform: the audit trail.

## Decision

**Permissions, not role names, are what code checks.** Role templates map to
permission sets; guards and use cases evaluate permissions.

```
membership → role template → permissions → checked at the call site
```

A permission is a stable string key scoped to an organization, e.g.
`tickets.read_branch`, `people.invite`, `audit.read`. `Actor` becomes:

```ts
interface Actor {
  readonly id: string;
  readonly organizationId: string;
  readonly permissions: ReadonlySet<string>;
}
```

`isStaff(actor)` and `isAdmin(actor)` are deleted, not adapted. That is
deliberate: a signature change would let the four duplicate definitions drift
silently, whereas deleting the symbol makes every one of them a compile
error that has to be looked at.

**Role templates are seeded, not hard-coded**, so custom roles later reuse
the same evaluator rather than needing a second mechanism. The initial
templates — owner, organization admin, branch manager, service desk manager,
team manager, agent, requester, auditor — are rows, and their permission
mappings are rows.

**Scope is part of the permission, not a separate parameter.** The ticket
read permissions are `tickets.read_own`, `tickets.read_branch`,
`tickets.read_team`, `tickets.read_all` rather than one `tickets.read` plus a
scope argument, because a scope argument is a thing a call site can forget to
pass and a permission key is not.

**Two rules that must hold regardless of template configuration:**

1. No organization-scoped role may grant a platform-level permission. A CSV
   import, a directory group or an organization admin must never be able to
   produce a `PLATFORM_SUPER_ADMIN`. This is an invariant of the evaluator,
   not of the seed data.
2. Permission checks are server-side. The frontend may hide controls; hiding
   is not authorization. This already holds — I traced every role-gated UI
   element in `apps/web` and each has a server-side counterpart — and it must
   survive the migration.

## What I found while auditing that changed the design

I expected to find the permission model half-present in role names, and to be
proposing a tightening. It is not half-present; `agent` and `admin` are the
only two role names that mean anything, and one of them is consulted once.

That is genuinely good news, and it is why I am proposing permissions rather
than scoped roles. There is no installed base of role semantics to preserve,
no migration of meaning to perform, and eleven call sites to change. Building
the more expressive model now costs roughly what building the narrower one
would, and the narrower one demonstrably does not survive first contact with
the retail-chain scenario — a branch manager who sees one branch cannot be
expressed as a global `agent` no matter how the string is spelled.

The one thing I would not do is design custom role editing now. Templates
mapping to permissions is enough for every scenario in the brief; per-tenant
custom roles reuse the same tables when someone actually needs them.

## Consequences

Positive:

- One evaluator, one vocabulary. The duplicate-predicate problem is fixed by
  construction rather than by discipline.
- The permission matrix becomes reviewable as data — it is a table someone
  can read and object to, instead of eleven scattered booleans.
- Scope lives in the key, so a forgotten scope argument is not a failure mode.

Negative / accepted:

- Deleting `isStaff`/`isAdmin` touches eleven call sites in six services plus
  four definitions. It is mechanical, and it must land in one change or the
  duplicates drift.
- `perms` in the token grows with the role. See ADR 0014 for the fallback if
  it becomes unreasonable.
- More upfront modelling than the current two booleans, for a product that
  today has two meaningful roles.

## Amendment — Sprint 9.4: the first evaluator increment is a code map

`isStaff`/`isAdmin` are deleted and every call site checks a permission key,
which forced the first version of the evaluator into existence. What shipped
deviates from this ADR in one deliberate way: **role templates map to
permissions through a code map in organizations-service
(`src/domain/permissions.ts`), not through seeded rows.**

The reason is a decision this ADR cannot settle by itself. The handoff
records an unresolved vocabulary question — this ADR names eight templates in
lowercase prose, the target-state document names nine in another convention
including a platform-scoped one, and the approved matrix uses an own-scope
qualifier on twelve cells that a flat string set cannot represent. Seeding
rows now would freeze provisional answers into data that migrations then have
to carry. A code map keeps the mapping reviewable and testable while leaving
the vocabulary question genuinely open; the seeded rows arrive with the
sprint that settles it, and custom roles still reuse the same evaluator shape
when they come.

Two boundaries hold regardless:

- **The key vocabulary lives in `libs/security` (`PERMISSIONS`)**, imported
  by both the map and every call site, so producer and checker cannot drift
  on spelling. Only keys with a real server-side call site exist — an
  unchecked key in a token is a claim nothing can falsify.
- **The agent template carries three marked interim widenings** of the
  approved matrix: `tickets.read_all` (the matrix wants team-scoped reads,
  and teams do not exist), `tickets.assign_agent` (the matrix reserves it
  for managers, who do not exist), and a flat `people.read` (the matrix
  grants it own-scope, and there is no scope to qualify by). Each is a
  behavior-preserving bridge, commented as such in the map, and shrinks to
  the matrix cell when branches and teams arrive. The own-scope cell that
  already had a home stayed there: a requester closing their own resolved
  ticket is domain logic, not a grantable key.

One narrowing was applied rather than bridged: agents no longer read the
analytics summary. The matrix gives `analytics.read` to owners, admins and
auditors only, the product ships no analytics UI, and a test pins the change
so it reads as a decision rather than an accident.

## Amendment — Sprint 9.14: the vocabulary question is settled

The amendment above deferred seeded rows on one stated ground: an unresolved
vocabulary question, where "this ADR names eight templates in lowercase prose,
the target-state document names nine in another convention including a
platform-scoped one, and the approved matrix uses an own-scope qualifier on
twelve cells that a flat string set cannot represent." All three parts are now
answered, and the count was wrong — it was seventeen cells, across twelve rows.

**One spelling.** The stable keys are the snake_case values already stored in
`memberships.role_template`, and they live in `libs/security`
(`ROLE_TEMPLATE_SCOPES`) beside the permission keys, imported by
organizations-service and by the browser. The alternative — renaming to match
the target-state document — was a data migration of every membership and
invitation row in exchange for a cosmetic. The documents moved instead. This
ADR's own prose spellings are shorthand for those keys, not a second
convention.

**The ninth template was a scope with nowhere to live.** Every template now
declares `organization` or `platform`, and grantability is derived from it.
Invariant 1 above — no organization-scoped role may grant a platform-level
permission — used to hold because the grantable list was "everything except
`owner`" and nothing platform-scoped happened to exist. Absence is not an
invariant. A test now constructs a platform-scoped template the way a future
sprint would add one and asserts the derivation refuses it. No such template
ships, because a key with no call site is a claim nothing can falsify.

**`○` was never going to be represented, and this ADR already said why.**
"Scope is part of the permission, not a separate parameter" settles it: an `○`
cell is either a distinct key, or domain logic, or deferred. The matrix now
classifies all seventeen. A deferred cell is a permission the template does not
hold, which a seeded row expresses as absence perfectly well.

**So seeded rows are unblocked, and are not this sprint's work.** Turning the
code map into rows is a migration, a repository and an evaluator change — a
mechanism sprint, where 9.14 was a vocabulary one. What changed is that nobody
is waiting on an open question any more; whoever picks it up is doing
engineering, not adjudication. The two boundaries in the amendment above hold
unchanged.

**One of the three interim widenings is gone.** The agent template still
carries `tickets.read_all` and `tickets.assign_agent`. The flat `people.read`
that Sprint 9.13 gave `service_desk_manager` was retired in 9.14 by
`people.read_assignable`, which is what a member picker actually needs: it
narrowed the key rather than the scope, because a picker exists to add somebody
who is not in the team yet. The agent's own flat `people.read` remains, and is
now the last of that shape.

## Related

ADR 0014 carries `perms` in the token. ADR 0013 puts the evaluator in
organizations-service. ADR 0021 bounds who may grant what. The approved matrix
lives in `docs/architecture/tenancy-target-state.md`.
