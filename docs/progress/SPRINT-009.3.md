# Sprint 9.3 — Event contracts v2

Status: **Phase 3 complete (2026-07-30), verified locally.** Nothing consumes
a v2 event. No schema anywhere changed, no column was added, no consumer file
was touched.

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

**Not verified remotely.** This branch is unpushed.

## Debts this phase creates

- **The organization on a ticket event is the caller's, not the ticket's.**
  `Ticket` has no organization column until phase 4. They cannot differ today
  because a caller only reaches tickets they may see, but nothing enforces
  that, and the two become separable the moment the column exists. Phase 4
  has to reconcile it.
- **Two publishes double the loss surface.** Publishing is best-effort with no
  outbox, so v1-lands-v2-lost is now a reachable state and produces asymmetric
  audit rows. Both calls are independently caught, which is correct; the
  asymmetry is the price.
- **`user.registered` stays tenant-free** until membership lifecycle events
  exist.

## What this phase deliberately did not do

No consumer reads a v2. No queue binds one. No `organization_id` column on any
table — that is phase 4, and it is what turns the caller-versus-subject
distinction above from theoretical into something that can actually be wrong.
No change to `canView`, no deletion of the duplicate `Actor` copies, no
membership lifecycle.

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
