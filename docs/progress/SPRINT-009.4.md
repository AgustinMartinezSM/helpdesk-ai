# Sprint 9.4 — Write paths, scoped reads, and the rest of phases 5 and 6

Status: **Phases 5 and 6 complete (2026-07-31).** The 2026-07-30 half ran
phase 6's writes and tickets-service's reads; the 2026-07-31 half ran
everything both phases still owed: the remaining scoped reads, the permission
cutover, the membership lifecycle, the consumer migration to the
tenant-carrying stream, assignee validation, and the backfill re-run. Phase 7
(`NOT NULL`, the first irreversible step) is deliberately not started — see
`docs/architecture/tenancy-phase-7-readiness.md`.

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

## The permission cutover (2026-07-31)

`isStaff`/`isAdmin` and the duplicate `Actor` copies are deleted in one
change, exactly as ADR 0015 argued: the symbol vanishing is what makes every
copy a compile error that has to be looked at. Call sites now check the
permission they always meant, drawn from a shared vocabulary in
`libs/security` so producer and checker cannot drift on spelling.

What forced the first evaluator increment into existence: a permission check
against a `perms` claim that is always empty denies everyone. So
organizations-service now resolves the claim from the membership's role
template through a code map — deliberately not the seeded rows ADR 0015 wants,
because the template-vocabulary question in the handoff is still open. The
agent template carries three marked interim widenings of the approved matrix
(`read_all`, `assign_agent`, flat `people.read`), each a behavior-preserving
bridge until branches and teams exist. One narrowing was applied instead of
bridged: agents lose the analytics summary, per the matrix, pinned by a test
so it reads as a decision. Both amendments are recorded in ADR 0015.

## The membership lifecycle exists now

Transitions (invited→active, active⇄suspended, anything-but-deactivated→
deactivated, no self-loops, deactivated terminal), a version bump on every
transition — which is what finally gives `mv` something to mean — and two
born-tenant-carrying events, `membership.created.v1` and
`membership.status-changed.v1`. Suspension takes effect at the next refresh,
because refresh re-resolves membership instead of copying claims; the
residual window is one access-token TTL, accepted by R7, except where the
next section closes it. The operator surface is an internal, guarded status
PATCH until the people-management sprint builds the real one.

## Consumers read the tenant-carrying stream

audit, analytics and notification consumers process v2 (and the membership
events) under a consume-side guard that dead-letters a tenantless envelope,
and acknowledge v1 as an explicit no-op. The no-op — rather than dropping the
v1 contracts from the subscription — is deliberate: the client only ever
binds, never unbinds, so removing v1 from the contracts list would leave the
durable queue's v1 bindings delivering messages nothing decodes, and
processing both versions would double-apply every fact under two envelope
ids. Since every write requires an organization, every v1 fact has a v2
twin; acking v1 loses nothing, and phase 8 removes the bindings with queue
surgery.

notification-service additionally compares tenant as well as id: a follow-up
event whose organization does not match the stored ticket ref dead-letters
instead of notifying, and the assigned path — which used to trust
`payload.assigneeId` with no lookup at all — now resolves the ref purely for
that comparison.

## The directory is scoped through a projection

users-service projects `membership.*.v1` into `directory_memberships` and
lists only active members of the caller's organization. `user_profiles`
still has no organization column — one column would assert one-org-per-person,
which ADR 0013 rejected — so the projection is the scope. Its rebuild path is
an operator script reading `helpdesk_organizations`, recorded in
`data-ownership.md`.

## Assignees are validated against live membership

`AssignTicketUseCase` no longer accepts any uuid. It asks
organizations-service — synchronously, with the internal credential — whether
the assignee holds an active membership in the ticket's organization with the
can-take-a-ticket grant, and fails closed when it cannot ask. This settled
the tension ADR 0014 recorded between "never call organizations-service
downstream" and "re-validate what cannot tolerate staleness": high-consequence
mutations may ask, read paths never do. The amendment in ADR 0014 draws the
boundary.

## The backfill, re-run and verified (2026-07-31)

As phase 4 predicted, re-running was mandatory rather than optional — though
the dev databases turned out clean (13 users, 13 memberships, 2
organization_admin + 11 requester; zero untenanted rows across all nine
scoped tables, because nothing wrote to the dev databases between the phases;
the `_test` databases absorb the integration churn). The sequence executed:
membership backfill re-run (idempotent, counts equal), directory projection
reconciled (13 = 13), tenant-column snapshot → dry run → execute → verify.
All five verification checks pass, and — new this sprint — all five now
actually flip the exit code; before, only the count comparison did, and a run
with untenanted rows still exited 0.

## Not done

- **Phase 7: `NOT NULL` and composite unique indexes.** The first step a code
  revert cannot undo. Preconditions, ordering, rollback and the evidence
  gathered so far live in `docs/architecture/tenancy-phase-7-readiness.md` —
  it waits for explicit approval.
- **Phase 8: stop publishing v1, remove the v1 no-op arms and their queue
  bindings, drop the `roles` compatibility claim.**
- **R13: the documented rebuild procedures are still cross-tenant staff
  reads**, and rebuilds must still be followed by the tenant backfill.
- **R9 beyond tickets-service:** the other integration suites still teardown
  with unfiltered `deleteMany()`.

## Verified

The 2026-07-30 half: full gate green locally and remotely (run `30589056698`
on `75b2bbb`, first attempt). The 2026-07-31 half: full gate green
(`format:check`, `lint`, `typecheck`, `test`, `build`) and all nine
integration suites against real PostgreSQL and RabbitMQ, including the new
adversarial coverage — audit's tenantless-v2 DLQ proof, analytics'
two-organization summaries, notification's mismatch dead-letters, users'
scoped directory end to end, organizations' lifecycle events on a real
broker. Remotely: GitHub Actions run `30642812316` on `7d19d22` — the full
gate plus all nine integration suites against real service containers —
green on its first attempt. The only annotation is the known
`pnpm/action-setup@v4` Node 20 deprecation warning, still tracked as its own
maintenance item.

## Documentation

Meaningfully changed this sprint: ADR 0014 and ADR 0015 gained amendments
recording the synchronous-call boundary and the code-map evaluator;
`SECURITY.md`'s authorization, token-claims and service-credential sections
were rewritten because the claims stopped being decorative;
`data-ownership.md` gained the `directory_memberships` projection, the third
synchronous edge and an updated rebuild note; `tenancy-migration-plan.md`'s
phase 5/6 entries and seven risk cells now record what landed;
`tenancy-target-state.md`'s header stopped claiming nothing reads the
claims; `local-development.md` covers the new tickets-service variables; and
`tenancy-phase-7-readiness.md` is new. Removed in passing: the stale
"requires approval" note on the already-approved matrix, and the
"auth-service is the only caller" comment on the internal endpoint. No
fictional experience, customers, incidents or approvals were introduced
anywhere in this sprint's documentation.
