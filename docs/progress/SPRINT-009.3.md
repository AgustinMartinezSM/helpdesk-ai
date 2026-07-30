# Sprint 9.3 — Event contracts v2 and tenant columns

Status: **Phases 3 and 4 complete (2026-07-30).** Nothing consumes a v2 event
and nothing reads an `organization_id`. Phase 3 changed no schema; phase 4
changed eight tables and no behaviour.

Goal: put an organization on the wire, so the three services that learn
everything from the bus will have something to scope by. This is the ordering
constraint the rest of the migration hangs off — audit, notification and
analytics cannot be made tenant-aware while the envelope has no tenant, and no
amount of work inside them helps until it does.

## The plan's wording was wrong, and worth being precise about

Phase 3 reads: _"`organizationId` required on the v2 envelope. Publish both v1
and v2 during the compatibility window."_

That sentence conflates two independent questions, and I went in circles for a
while before separating them:

- **How does a consumer tell old from new?** Version in the contract name, or
  a version on the envelope?
- **Where does the tenant sit?** On the envelope, or inside each payload?

"The v2 envelope" has no referent in the code. `EventContract` has two fields,
`type` and `payloadSchema`, and neither is a version. The envelope has five
keys and none of them is a version either. The only version carrier in the
whole system is the type string, which is also the routing key.

### The versioning axis is not actually ambiguous

Read alone, "the v2 envelope" sounds like mutating the shared envelope in
place and leaving every type string at `.v1`. That is the cheapest possible
diff, and three other sentences in the same plan make it unimplementable:

- the checkpoint is _"both versions on the bus, nothing consuming v2 yet"_ —
  with one stream there is one version and every consumer is already reading
  it;
- phase 8 is _"stop publishing v1 once every consumer reads v2"_ — meaningless
  if no separately-named v1 stream ever existed;
- _"consumers keep reading v1"_ — requires a v1 stream that still exists
  unchanged.

And it would have shipped a wire change to four services in the one phase
whose entire point is that nothing downstream moves. So: version in the name,
exactly as ADR 0005 already required.

### The field location was a real decision, and no document made it

**The tenant goes on the envelope.** Two reasons, and the second is the one
that decided it.

Every contract names its subject differently — `ticketId`, `userId`,
`suggestionId`. R4 already records this as the reason the audit backfill is
not uniformly derivable. Putting the tenant in payloads would reproduce that
problem on the wire instead of fixing it.

And audit-service decodes every event with envelope-only validation, because
it holds a schema for none of them. A payload field would be invisible to
exactly the consumer that most needs it. On the envelope it sits next to
`correlationId`, which is the precedent: both describe the delivery rather
than the subject, and neither belongs to any one contract.

A trap that nearly made this silent: every schema here is a bare `z.object`,
so zod strips unknown keys. Publishing an `organizationId` without adding it
to `eventEnvelopeSchema` would have dropped it at every consumer, including
audit, with nothing anywhere to explain the absence. There is a test for that
now.

ADR 0005 settled how a _contract_ evolves and said nothing about how the
_envelope_ does. That gap is now closed in the ADR itself rather than left
implicit in a commit.

## `user.registered` has no v2, and cannot have one

This is the finding I did not expect.

Registration is anonymous — `POST /auth/register` carries no token, so there
is no `org` claim to read. That much is a plumbing gap. The part that is not:
**the event is the cause of the membership, not a consequence of it.**
organizations-service consumes `user.registered.v1` and creates the membership
by looking up the bootstrap slug on the consumer side. At the instant the
event is published, no membership exists to supply a tenant.

So a `user.registered.v2` with a required organization would be a required
field that is never satisfied — precisely the design problem this phase exists
to avoid, minted on purpose. Five v2 contracts, not six.

The alternatives I rejected: making organization selection an input to
registration (new API surface, a product decision about self-serve versus
invitation, and a synchronous write-path dependency from auth-service — far
outside a phase whose revert is "stop publishing v2"), and having
organizations-service publish a membership event that downstream keys on
instead (the right answer, and it belongs to the phase that builds membership
lifecycle).

The cost I am accepting: audit's tenant column for `user.registered` rows has
to come from R4's per-event-type map permanently. That was R4's job either
way.

## A v2 is skipped, not faked, when there is no tenant

Sprint 9.2 shipped fail-open resolution, so this is not an edge case: a token
minted while organizations-service is unavailable carries no organization, and
so does one for a user whose membership has not been backfilled.

v1 goes out unconditionally. v2 goes out only when the caller's organization
is known; otherwise the adapter logs a warning naming the contract and the
subject, and skips it.

Publishing a tenant-free v2 would produce exactly the message the next phase
is supposed to reject, which would make the migration harder rather than
easier. Defaulting to the bootstrap organization was the other option, and the
threat model is explicit that consumers reject rather than default — _"DLQ, do
not guess"_. Worth noting the asymmetry there: R4 authorises exactly that
defaulting for the audit _backfill_, logged rather than silent. A backfill may
guess about the past; a live publisher may not guess about the present.

Nothing in `libs/messaging` can enforce any of this — `buildEnvelope` validates
the payload and never the envelope — so the guard is written out at each
adapter, where the reason for a missing tenant is still known. That is the
single most important line in the phase, and it is deliberately not hidden
behind a schema.

The skip count is the metric that says whether phase 6 can safely start
rejecting. It is the same signal the mint-time warning already asks operators
to watch.

## The audit trail now records two rows per fact

`audit-service.event-log` binds `#`, the only wildcard in the repository, so it
receives both versions. The two envelopes have two random ids, so the id-keyed
dedupe that collapses a redelivery cannot collapse these.

This runs for the whole compatibility window — phase 3 until phase 8 stops
publishing v1. Anything counting audit rows per logical fact double-counts
across it.

Both publishes carry the same `correlationId`, which is the only handle that
groups them back into one request. That cost nothing and is the difference
between the duplication being tolerable and being noise. An integration test
pins the two rows as intended behaviour, so phase 4 meets it in a test rather
than in a verification query.

## What did not change, by construction

No consumer file was touched. users-service, organizations-service,
notification-service and analytics-service bind nine exact-literal routing
keys between them, with no wildcards; in a topic exchange `.` is the word
separator, so `ticket.created.v1` does not match `ticket.created.v2`. Those
queues receive nothing new — not delivered, not decoded, not dead-lettered.

An integration test proves it rather than arguing it: publish a v2, then
publish a v1 sentinel, and assert the sentinel arrives while the v2 never did
and the dead-letter queue stays empty. A positive event as the fence, instead
of sleeping on a timeout.

## Verified

Full gate green: `format:check`, `lint` (15 projects, 0 errors, 9 pre-existing
warnings), `typecheck` (14), `test` (15), `build` (15). All nine integration
suites against real PostgreSQL and RabbitMQ.

Against the real broker specifically:

- Both versions of one fact reach a firehose subscriber with distinct envelope
  ids, a shared `correlationId`, identical payloads, and the organization
  present only on the v2.
- A v2 is not routed to a queue bound to v1, and nothing dead-letters.
- The audit trail records both as two rows, joined by the trace id.

The adapter specs are where the skip rule is actually enforced: one call
produces two publishes with an organization and exactly one without, the
payload object is shared so the versions cannot describe the same fact
differently, and a v1 that fails to publish does not suppress the v2.

**Verified remotely too.** `main` was fast-forwarded to `cd033ab` — no merge
commit, no rewritten history — and pushed. GitHub Actions run `30582924271`
was green on its first attempt, with the same counts the local gate reported
and all nine integration suites against real service containers.

Phase 4 followed the same way: `main` fast-forwarded to `e3ecbc5`, run
`30585275171` green on its first attempt. That run is the one that matters
most of the two, because it applied all five migrations and their backfills to
databases created from scratch — which is a different claim from applying them
to this machine's, where the tables already had rows.

## Phase 4 — the columns exist

Eight tables across five services gained a nullable `organization_id`, and
every row that existed was assigned the bootstrap organization. Nothing reads
it: no domain type, no repository mapper and no API response mentions the
column, which is what makes the checkpoint something you can check rather than
something you assert.

### Eight tables, not the ten the plan listed

`user_profiles` and `user_snapshots` are projected from `user.registered` —
the contract phase 3 established has no v2 and cannot have one, because the
membership that would supply a tenant is created by consuming that very event.

So the column would have had no source. The choice was between hardcoding the
bootstrap organization inside two consumers, which is a constant somebody has
to remember to remove, and letting new rows accumulate nulls with no date on
which anything fills them. Waiting for the membership lifecycle events in
phase 6 is better than both, and both tables are rebuildable projections, so
arriving late costs nothing.

There is a modelling reason underneath the practical one. A single
`organization_id` on `user_profiles` asserts that a person belongs to one
organization. That is precisely what ADR 0013 avoided when it made membership
its own table rather than a column on a user.

### The checkpoint overstates itself, and it matters for phase 7

The plan says phase 4 ends with the columns "fully populated". That is true at
the instant of the backfill and stops being true immediately: consumers do not
set the column until phase 6, so every row written in between is null.

That is a consequence of the plan's own ordering rather than a mistake in it.
But it means phase 7 has to **re-run the backfill**, not merely re-run the
verification, before it can add `NOT NULL`. I would rather write that down now
than have phase 7 discover it as a failing constraint.

### Where the backfill lives, and why it differs from the last one

In the migrations, not in an operator script. The membership backfill had to
be a script because it read one database and wrote another; here every
`UPDATE` stays inside the service's own database, and `prisma migrate deploy`
is the only provisioning step that runs both locally and in CI.

Each statement is scoped to `WHERE organization_id IS NULL`, so re-running is
a no-op and cannot overwrite a value a later phase set on purpose.

The bootstrap organization's id appears as a literal in five migrations. It
cannot be looked up — organizations live in another service's database — and
that is exactly why it was created as a fixed, obviously synthetic uuid rather
than a random one back in phase 1.

### audit_events

Every historical row got the bootstrap organization, and R4's per-event-type
map was not applied, because there was nothing for it to disambiguate: every
row predates the existence of a second organization. The map becomes necessary
when the trail spans more than one — and by then the tenant arrives on the v2
envelope anyway, so the map may never be the mechanism at all.

Persisting the envelope value is a consumer change, so it waits for phase 6.
Until then new audit rows are null.

This backfill is also the only `UPDATE` that table will ever take. The trail is
append-only to the application; a migration is not the application.

### The verification found nothing, after I fixed the verification

`infrastructure/postgres/operations/verify-tenant-columns.sh` runs the plan's
four checks plus a fifth. Row counts against a pre-migration snapshot:
identical. Rows still untenanted: zero in all eight tables. Ids that do not
resolve against `helpdesk_organizations`: none. Ticket agreeing with its
comments and history: yes. Everything on the bootstrap organization: yes.

The ticket-agreement check was wrong twice before it was right, and the first
run flagged a ticket that was perfectly fine. A `LEFT JOIN` reports a ticket
with no comments as a disagreement, because `NULL IS DISTINCT FROM <uuid>` is
true — and joining both child tables in one query multiplies them into a
cartesian product that inflates every count.

What caught it was that the checks disagreed with each other: check 2 said
zero nulls and check 5 said everything was on the bootstrap organization,
which left no way for check 4's row to be real. A single check would have been
believed. Both mistakes are commented in the script.

## Debts this phase creates

- **The organization on a ticket event is the caller's, not the ticket's.**
  Phase 4 gave `Ticket` its column, so the two are now separable — but nothing
  compares them, because the write paths do not set the column yet. The
  reconciliation moves to phase 6, where writes start taking the organization
  from the actor's claim and a mismatch becomes something that can be
  detected and refused.
- **Every row written between phase 4 and phase 6 has a null organization.**
  Phase 7 must re-run the backfill before adding `NOT NULL`, not merely re-run
  the verification.
- **Two publishes double the loss surface.** Publishing is best-effort with no
  outbox, so v1-lands-v2-lost is now a reachable state and produces asymmetric
  audit rows. Both calls are independently caught, which is correct; the
  asymmetry is the price.
- **`user.registered` stays tenant-free** until membership lifecycle events
  exist.

## What this phase deliberately did not do

No consumer reads a v2 and no queue binds one. Nothing reads an
`organization_id`: not a domain type, not a repository mapper, not an API
response. No write path sets one. No `NOT NULL`, no composite index — those
are the enforcement phase, and it is the first step that cannot be undone by
reverting code.

No change to `canView`, no deletion of the duplicate `Actor` copies, no
membership lifecycle, no assignee validation.

`isStaff` is still defined four times.

## Documentation

Improved: ADR 0005 gained the envelope-evolution rule it never had, stated as
a rule rather than as a description of one commit; `messaging.md` records the
v2 contracts, the compatibility window, the `user.registered` exception and
the audit double-row arithmetic; the migration plan records phase 3 as done
along with the wording problem and both deviations, so a later reader does not
re-litigate the decision from the same ambiguous sentence.

No fictional experience, employer, customer, production incident or external
approval appears anywhere in this sprint's writing, and nothing is described
as deployed or remotely verified.
