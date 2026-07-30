# ADR 0015 — Permission model

- Status: **Proposed** (Sprint 9.1 audit; not approved)
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

## Related

ADR 0014 carries `perms` in the token. ADR 0013 puts the evaluator in
organizations-service. The draft matrix lives in
`docs/architecture/tenancy-target-state.md` and requires approval before it
is treated as decided.
