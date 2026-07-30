# ADR 0012 — Tenant isolation model

- Status: Accepted (approved 2026-07-30)
- Date: 2026-07-30
- Sprint: 9.1 (Product domain and tenancy audit)

## Context

The platform is single-tenant today, and completely so. A case-insensitive
grep for `tenant|organization|organisation|orgId|workspace` across every
`apps/*/src`, `apps/*/prisma` and `libs/*/src` returns **zero matches**.
There is no half-finished scaffolding to reconcile and nothing to un-pick.

That also means nothing will fail when tenant scoping is forgotten. No type,
no constraint and no test currently encodes the idea that two organizations
exist, so every isolation guarantee has to be built rather than tightened.

Three facts about the current system constrain the choice of isolation
mechanism, and I verified each of them rather than assuming:

**Provisioning is per service, not per tenant.** One init script
(`infrastructure/postgres/init/01-service-databases.sh`) creates seven roles
and fourteen databases — a live and a `_test` per service. Ownership is
enforced by credentials, not convention (ADR 0003).

**There is no central place to route a connection.** All seven
`prisma.config.ts` files are byte-identical and resolve `DATABASE_URL` from
the environment. The service→database binding lives in each app's
`package.json` and its untracked `.env`. There is no registry a tenant-aware
router could consult.

**There is no database-level guard of any kind.** `tickets-service`'s single
migration has no check constraints, no partial indexes and no row-level
security. Access is decided in exactly one layer — the use case — and
`apps/tickets-service/src/application/use-cases/ticket-lifecycle.ts:79`
already contains one endpoint that forgets to call it.

## Decision

**Tenancy is a column, inside the existing per-service databases.** Every
organization-owned row carries an `organization_id`; no new database, schema
or connection is introduced per tenant.

The alternatives were weighed against the three facts above rather than in
the abstract:

| Model               | Verdict                                                                                                                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Column per row      | **Chosen.** No provisioning change. Integration tests can hold two organizations in one `_test` database, so the existing harness survives.                                                                             |
| Schema per tenant   | Rejected. `prisma migrate deploy` runs once per service against one `DATABASE_URL`; per-tenant schemas mean per-tenant migration runs and a registry that does not exist.                                               |
| Database per tenant | Rejected harder. The seven-database split is per _service_; per-tenant databases would multiply that by every organization and require rewriting the init script, the CI provisioning and every service's env handling. |

Two supporting rules come with it:

**`organization_id` is denormalized only where it buys index selectivity.**
`ticket_comments` and `ticket_history` inherit tenancy through their
intra-service foreign key to `tickets`, so they can be scoped by join. I
would still add the column to both, for one reason: `historyFor(ticketId)`
and `commentsFor(ticketId, includeInternal)` query those tables _without_
joining `tickets`, so a join-only design leaves those two queries with
nothing to filter on.

**Row-level security is proposed as a second phase, not skipped and not
assumed.** Today there is exactly one layer deciding access and no backstop
beneath it. Postgres RLS would be that backstop. I am not proposing it for
the first migration sprint, because RLS requires the session to carry the
tenant (`SET LOCAL`) and Prisma's connection pooling makes that a real design
problem rather than a switch. It belongs in its own sprint, after the column
exists and the application layer is correct — but the migration should not
be designed in a way that forecloses it.

## What I considered and rejected

I initially expected the answer to be "add `organization_id` everywhere and
move on". The audit changed that in two places.

**Not every table should get the column.** Of twelve tables, ten are
organization-owned and two are global identity data — `users` and
`refresh_tokens` in `helpdesk_auth`. A person is one account platform-wide
(the email unique index enforces it), so the account cannot belong to an
organization. Putting `organization_id` on `users` would either forbid a
person from ever joining a second organization or force duplicate accounts
for the same human. That is the decision ADR 0013 exists to make, and it has
to be made _before_ the column is added anywhere, not after.

**The unique-constraint surface is far smaller than I expected.** An
exhaustive grep of all seven `migration.sql` files for `UNIQUE` returns
exactly three non-primary-key constraints in the entire platform:
`users(email)`, `user_profiles(email)`, and
`notifications(user_id, source_event_id)`. The third survives untouched —
`user_id` is tenant-implied once a user belongs to an organization, and
`source_event_id` is a global uuid. So only **two** constraints are in
question, and they are the same constraint expressed twice: the email in
auth-service and the email in its users-service projection. They must change
together or the projection starts rejecting rows its source accepted.

Most importantly: **there is no ticket code, number or slug anywhere.**
Tickets are identified by uuid alone. That is the luckiest fact in this
migration — there is no per-tenant sequence to design and no human-readable
identifier to make composite.

## Consequences

Positive:

- No infrastructure change. The seven-database split, the init script, the CI
  provisioning and every `prisma.config.ts` stay as they are.
- The existing integration harness works, provided fixtures create two
  organizations instead of assuming they own the database.
- A single migration path per service, expressible as ordinary SQL.

Negative / accepted:

- **Isolation is enforced entirely in application code** until RLS lands. A
  forgotten `WHERE` is a cross-tenant read with nothing beneath it to refuse.
  That is the same exposure the system has today for cross-_user_ access; the
  difference is that the blast radius becomes another company's data.
- Every organization-scoped query gains a predicate, and every composite index
  needs `organization_id` first. Query plans will change.
- A noisy tenant shares table space and indexes with quiet ones. Acceptable at
  this stage; it is the standard trade for column-based tenancy.

## Related

ADR 0003 constrains what an `organizations` table may be referenced by: no
cross-service foreign keys, ever. ADR 0013 decides who owns it.
