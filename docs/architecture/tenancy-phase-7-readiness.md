# Phase 7 readiness — enforce `NOT NULL` on the tenant columns

Status: **Approved and executed 2026-07-31.** The sections below are the
readiness analysis as approved; the outcome record at the end says what the
execution actually did, including the one thing the analysis missed.

Phase 7 is the first step in the tenancy migration that a code revert cannot
undo: rollback from here is a forward migration making columns nullable
again — safe, but a migration, not a `git revert`.

## What phase 7 would do

1. Set `NOT NULL` on `organization_id` in the nine scoped tables:
   `tickets`, `ticket_comments`, `ticket_history` (tickets-service);
   `suggestions` (ai-service); `ticket_snapshots`, `user_snapshots`
   (analytics-service); `ticket_refs`, `notifications`
   (notification-service); `audit_events` (audit-service).
2. Add composite indexes with `organization_id` first where the scoped read
   shape is not already covered. Most landed in Sprint 9.4
   (`[organization_id, occurred_at]` on audit_events,
   `[user_id, organization_id, created_at]` on notifications,
   `[organization_id]` on both snapshot tables); tickets-service's list shape
   should be re-examined against its query plan before phase 7 fixes one.
3. Make the scope non-optional in the remaining types: `Actor.organizationId`
   and `Actor.permissions` become required, which turns every call site that
   has not been updated into a compile error — the payoff the optional fields
   have been waiting for since phase 2.

`user_profiles`, `users` and `refresh_tokens` are exempt by design: global
identity (ADR 0017), session-belongs-to-a-person (ADR 0014), and
one-column-asserts-one-org (ADR 0013) respectively. `directory_memberships`
needs no constraint — its organization is part of the primary key and cannot
be null.

## Precondition queries, and their current answers

Each `NOT NULL` requires zero nulls in its table. The check, per table:

```sql
SELECT count(*) FROM <table> WHERE organization_id IS NULL;  -- must be 0
```

Executed 2026-07-31 via `verify-tenant-columns.sh` after the backfill
sequence below: **zero across all nine tables** (7 tickets, 8 comments, 19
history, 18 suggestions, 1 ticket_snapshot, 2 user_snapshots, 2 ticket_refs,
3 notifications, 39 audit_events). Also verified: row counts identical before
and after the backfill, every organization id resolves against
`helpdesk_organizations`, tickets agree with their comments and history, and
every row sits on the bootstrap organization — expected while it is the only
one.

## Why the backfill had to be re-run, and what it found

Every row written between the phase-4 backfill and the Sprint 9.4 consumer
cutover carries NULL — the plan's own ordering guarantees it. Re-running only
the verification would pass on stale data and then the constraint would fail.
The sequence executed on 2026-07-31, in order:

1. Services stopped (only the compose infrastructure running; the `_test`
   databases absorb integration churn and are out of scope).
2. `backfill-bootstrap-memberships.sh` re-run — idempotent: 13 users, 13
   memberships, 2 `organization_admin` + 11 `requester`, zero users without
   a membership, zero duplicates (the unique key makes them impossible).
3. `backfill-directory-memberships.sh` — the new users-service projection
   reconciled: 13 source memberships, 13 projected rows, statuses agree.
4. `verify-tenant-columns.sh --snapshot`, then
   `backfill-tenant-columns.sh --dry-run`, then the execute run, then the
   full verification. The dev databases turned out to have **zero
   untenanted rows even before the execute run** — nothing wrote to them
   between the phases (all activity since phase 4 was integration tests
   against `_test` databases), and the analytics migration backfilled
   `user_snapshots` on creation. The execute run therefore updated zero rows,
   which is also the idempotency proof the plan asks for: a second execution
   performs no work.

In any deployed environment this cleanliness would NOT hold — rows written
during the window would be real. The sequence above is the procedure such an
environment must run, and `backfill-tenant-columns.sh` refuses to run at all
once a second organization exists, because uniform assignment to the
bootstrap organization stops being derivable then (R4).

## Evidence that writes now supply the organization

- Every write in tickets-service and ai-service takes the organization from
  the token through `requireOrganization` (`d87e187`); the domain types
  require it, so a missing check is a compile error.
- Every consumer that projects organization-owned rows reads the
  tenant-carrying stream and dead-letters a tenantless envelope (`67f1906`,
  `078da2d`, `8ece501`). The v1 no-op arms write nothing.
- `user_snapshots` rows created by `user.registered.v1` are the one remaining
  organization-less write, by design — registration is anonymous. The row
  gains its organization from `membership.created.v1`, normally milliseconds
  later. **Consequence for phase 7: the `NOT NULL` on
  `user_snapshots.organization_id` would reject the registration-first write
  path.** Before enforcing it there, the consumer must either buffer the
  registration apply until the membership arrives, or the constraint must be
  scoped to the other eight tables and `user_snapshots` documented as
  nullable-by-design with its scoped reads already excluding nulls. The
  second is the honest cheap option; deciding is part of the phase 7
  approval.

## Migration ordering and availability impact

One migration per service, each `ALTER TABLE ... SET NOT NULL` preceded in
the same file by the guard `UPDATE ... WHERE organization_id IS NULL` (a
no-op when the precondition holds, insurance when it does not). `SET NOT
NULL` takes an ACCESS EXCLUSIVE lock and scans the table; at local/dev sizes
that is milliseconds, and there is no deployed environment. Order across
services does not matter — no service reads another's tables — but running
them all in one operational window keeps the platform's guarantees uniform.

## Rollback

A forward migration per service: `ALTER TABLE ... DROP NOT NULL`. Data is
untouched in either direction. The `Actor` type change reverts with code.

## Compatibility code that phase 8 (not 7) removes

- The dual v1/v2 publish in tickets-service and ai-service.
- The v1 no-op arms in the three consumers, and the durable queues' v1
  bindings (queue surgery: unbind or re-create).
- The `roles` compatibility claim, and users-service's projected `roles`
  column (R14).
- The `organizationId: string | null` legs on domain types whose columns
  become NOT NULL.

## Legacy paths that still exist, honestly listed

- `INTERNAL_SERVICE_TOKEN` is optional in auth-service (degrade-open, mints
  claimless tokens) and tickets-service (fail-closed, refuses assignment).
  Phase 7's Actor tightening is the natural moment to make it required in
  auth-service, because a claimless token stops being usable for anything.
- The documented rebuild procedures still refetch without a tenant and must
  be followed by the backfill (R13).
- Integration suites outside tickets-service still teardown with unfiltered
  `deleteMany()` (R9).

## Risk if interrupted

Each migration is a single transaction per service; an interruption leaves
that service's constraint unapplied and everything else unchanged. Re-running
is safe: the guard UPDATE is idempotent and `SET NOT NULL` is not partial.
The platform runs correctly in the mixed state — the constraint is a net
under behavior the code already enforces, not new behavior.

## Outcome record — executed 2026-07-31 (`88b2cd6`)

**Seven tables constrained, not nine.** The analysis above already exempted
`user_snapshots`; execution surfaced a second structural exemption this
document had missed: **`audit_events` cannot be `NOT NULL` while
`user.registered.v1` exists**, because the firehose records every event,
registration is anonymous forever, and the constraint would have
dead-lettered every registration record. Both exemptions are
nullable-by-design, spelled out on their schema comments, and the verifier
prints their null counts as informational instead of failing on them. Their
scoped reads already exclude nulls, so nothing user-visible changes.

**Applied**: guard-UPDATE-then-`SET NOT NULL` migrations in tickets-service
(three tables), ai-service, analytics-service (`ticket_snapshots` only) and
notification-service (two tables), verified with `prisma migrate diff`
(no drift) and by the integration suites' `migrate deploy` against populated
`_test` databases. One index added because a real query needed it —
`[organization_id, created_at]` for the tickets list; ai-service's reads
turned out to filter by ticket id under the permission gate, so the index
this document guessed at was not added.

**The constraint deleted code, as predicted**: the regenerated client types
forced out three now-unreachable defensive branches (tickets'
refuse-and-name-the-row, ai's skip-with-warning, notification's legacy-null
ref leg), and `TicketRef`/`TicketSnapshot` carry a required organization in
their domains. A new integration test proves the net: inserting a tenantless
row violates the constraint.

**The `Actor` tightening** rides with the phase-8 claims cleanup rather than
this migration, so the fixture churn happens once: `permissions` becomes
required; `organizationId` deliberately stays optional, because a token for
an account that belongs nowhere is a real minted state the product preserves
(registration→membership is racy), and the refusal lives in
`requireOrganization`.
