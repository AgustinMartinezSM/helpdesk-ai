# Sprint 9.4 — Write paths, and the first scoped reads

Status: **In progress (2026-07-30).** Phase 6's write half is complete. Phase
5's read half is complete for tickets-service and not started for
users-service, audit-service or analytics-service.

## The plan's order was wrong, and following it would have broken the product

The plan puts read paths (phase 5) before write paths (phase 6). Doing that
literally produces a broken intermediate state: reads would filter by
`organization_id`, writes would not set it yet, so a ticket created in that
window would have a null organization and **its own author would not find
it**.

Writes first has no such state. The leak window is exactly what it is today —
reads were already unscoped — and phase 5 then scopes data that is already
labelled correctly.

So this sprint runs phase 6's write half, then phase 5's read half. The
checkpoint the plan wrote for phase 5 ("reads are tenant-safe; writes still
accept anything") is inverted into "writes are tenant-safe; reads are being
scoped service by service".

## Membership resolution fails closed now — but only on uncertainty

Every document since Sprint 9.2 has said fail-open must end "the moment write
paths start setting the organization from the claim". That moment is this
sprint.

The distinction that makes it safe is one the resolver has preserved since
phase 2, and it turned out to be the load-bearing decision of the whole
sprint:

- **`null` — "I asked, and this person belongs to no organization."** A real
  answer. A token is still minted, with no tenant claims. This is ordinary,
  not exceptional: it is the state of every account between registering and
  organizations-service consuming the registration event, which is normally
  milliseconds and is not guaranteed. Failing login here would have made
  register-then-login racy.
- **A throw — "I could not ask."** Unreachable service, rejected credential,
  a body that did not parse. Nothing is known, so nothing is minted.

Only the second refuses, and it answers **503, not 401**. The caller's
password was fine; a 401 would send them to reset one that works.

The first case is then caught at the write, where the alternative would be a
row nobody can be shown to own. `NoOrganizationContextError` is a 403 with a
message that says what is actually wrong.

## `requireOrganization` makes the check impossible to skip quietly

The domain types now require `organizationId`, and the actor's is optional.
The only bridge between them is a function that throws. A write path cannot
obtain a usable value without passing through the refusal, so forgetting the
check is a **type error**, not a row belonging to nobody.

That is the same reasoning ADR 0015 used to justify deleting `isStaff` rather
than changing its signature: make the compiler the reminder.

In ai-service the guard sits before the ticket fetch and before the provider
call. A suggestion nothing can attribute is a record of spend nobody owns, and
refusing early also stops the money.

## The caller-versus-ticket debt is discharged

Phase 3 recorded that a ticket event carried the **caller's** organization
because the ticket had none. It has one now, so:

- a comment and a history entry take **the ticket's** tenant, not the
  writer's — a comment belongs to its ticket's tenant regardless of who wrote
  it;
- a mutation insists the caller is acting _inside_ the ticket's organization,
  not merely able to see it.

Nothing can reach that second check through the read path any more, because
the scoped `findById` never hands over a foreign ticket. That is exactly why
it is still there and still tested directly: it does not depend on the read
staying correct.

## Scoped reads, for tickets-service

`findById` takes the organization before the id. `TicketListFilter` makes
`organizationId` required while every other field stays optional — and that
asymmetry is the point. The filter builds its predicate from optional spreads,
so before this a forgotten field _widened_ the query: `list({skip, take})`
returned the whole table. A required field cannot be forgotten quietly, which
is R1's entire argument.

`findFirst` rather than `findUnique`, so the organization is part of the
predicate. A foreign ticket answers null exactly as a missing one does — a 404
rather than a 403, because confirming existence is the leak.

The in-memory double enforces the scope for real. A double that accepted and
ignored it would let every unit test pass against a repository that leaks,
which is the precise failure the phase 0 assertions exist to catch.

### Two tests changed shape rather than being adjusted

The integration spec's "returns every ticket when no requester filter is
passed" was written to document the fail-open behaviour, and its own comment
said it must be rewritten deliberately once the scope became required. This is
that rewrite — the unscoped call no longer compiles. The new two-organization
test plants a foreign ticket carrying **the same requester id**, so nothing
but the organization can be doing the filtering.

The use-case test expecting "forbidden" for staff in another organization now
expects "not found", because the scoped read means they never learn the ticket
exists.

## Also fixed here

The ticket error filter defaulted to 404, so any domain error nobody had
mapped silently became "not found" — and one did: a caller with no
organization got a 404 for the ticket they were creating. Every error is now
listed explicitly and the fallback is 500.

A stored row with no organization is a provisioning fault, not a request
fault. tickets-service refuses to serve it and names the row so the backfill
can be re-run; ai-service skips it with a warning, following the pattern
already there for rows whose stored output no longer parses. Neither guesses:
putting somebody else's row in front of a reader is the failure this whole
migration exists to prevent.

## Not done

- **users-service directory, the audit filter, the five analytics
  aggregates.** Still unscoped.
- **`isStaff`/`isAdmin` are still defined four times.** Deleting them and the
  duplicate `Actor` copies has to land in one change or the copies drift.
- **Consumers still read v1.** They do not set `organization_id` on the rows
  they project, so those rows are still null for anything written since phase 4. The enforcement phase has to re-run the backfill regardless.
- **Assignee validation.** `AssignTicketUseCase` still accepts any uuid. It
  gets cheaper once the read scope exists, which it now does for tickets —
  but validating that the assignee is a member needs membership data
  tickets-service does not have.
- **`NOT NULL` and composite indexes.** The enforcement phase, and the first
  step that a code revert cannot undo.

## Verified

Full gate green: `format:check`, `lint` (15 projects), `typecheck` (14),
`test` (15), `build` (15). All nine integration suites against real PostgreSQL
and RabbitMQ, tickets-service now at nine including the two-organization
isolation test.

Remotely too: `main` fast-forwarded to `75b2bbb`, GitHub Actions run
`30589056698` green on its first attempt.
