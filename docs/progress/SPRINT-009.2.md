# Sprint 9.2 — Tenant foundation

Status: **CLOSED (2026-07-30).** Phases 0, 1 and 2 of
`docs/architecture/tenancy-migration-plan.md` are implemented and verified
locally. No table anywhere gained an `organization_id` column; no event
contract was versioned; no authorization behaviour changed.

Goal: build the ground the tenancy migration stands on, and end with a
platform that behaves exactly as it did before, plus an organization nobody
references. If anything a user can see had changed, the sprint would have
done too much.

## What shipped

Four commits on `feat/s9-2-tenant-foundation`.

| Commit    | What                                                           |
| --------- | -------------------------------------------------------------- |
| `e2e37dc` | Phase 0 — isolation assertions that fail against a leaky repo  |
| `3a913f0` | `correlationId` threaded through all three publishers          |
| `0e835e0` | Phase 1 — organizations-service and the bootstrap organization |
| `c0d24cc` | Phase 2 — `org`, `perms` and `mv` in the access token          |

## Phase 0 — proving the leak first

The migration plan opens by writing the two-organization isolation tests and
watching them fail, because R2 said the existing suite could not detect the
failure mode the migration risks.

It could not, and I verified that by mutation rather than by argument.
Dropping the scope from `findMany` while leaving it on `count` keeps every
total correct, and the old spec passed 4 of 4 against a repository returning
another requester's rows. The new assertions fail 3 of 7 against that same
code. Both mutations were reverted afterwards and the repository is
byte-identical to what it was.

The change is small and the discipline is the point: list tests compare
sorted ids, the status-filter test plants a foreign row carrying the status
the filter selects, and one test pins the fail-open shape of `list` so that
making the scope required has to be a deliberate rewrite rather than an
accident.

**R9 is only partly done, and I would rather say so than let the phase read
as complete.** The plan asked for a shared fixture module that creates two
organizations and scopes teardown, because every integration suite calls an
unfiltered `deleteMany()`. What exists is
`apps/tickets-service/src/testing/fixtures.ts` — one service's fixtures, the
single place `organizationId` will land when it becomes required. It is not
shared and it creates no organizations.

That is not laziness so much as sequencing: there is nothing to scope
teardown _by_ until the tables have an `organization_id` column, which is
the backfill phase. The residual risk is unchanged in the meantime, because
no suite is two-tenant yet. It becomes real the moment one is, and that is
when the shared module has to exist.

## `correlationId` — cheap, and I was wrong about that

The plan called this cheap and independent. It was independent. It touched
thirteen files across three services, because threading is explicit — an
optional last parameter on four ticket use cases and one auth use case,
following ai-service's existing precedent rather than introducing
AsyncLocalStorage.

Worth doing regardless: every envelope had been reaching the broker with a
null `correlationId`, so no audit row could be joined back to the request
that caused it.

## Phase 1 — organizations-service

A ninth service on port 3010 owning `helpdesk_organizations`, with two
tables. It consumes `user.registered.v1` on its own durable queue, exposes one
internal endpoint, and publishes nothing.

**It is deliberately absent from the api-gateway.** Browsers have no route to
it at all. Only auth-service calls it, directly, server to server — the
precedent ADR 0011 set for internal calls.

**It declares no `JWT_ACCESS_SECRET`**, unlike every other service. It has no
person-facing endpoint, so it verifies no access tokens, and carrying the key
that signs people's sessions would be configuration it never reads.

### The thing that made this service different to write

Every store in this platform until now has been disposable. `user_profiles`,
`ticket_refs` and `ticket_snapshots` can each be dropped and rebuilt from the
event log, and `data-ownership.md` documents how. Memberships are the first
data here that cannot be — losing one locks a person out of an organization.

That changed two decisions that would otherwise have been copied from the
template without thinking about them.

The consumer creates a membership if none exists and **leaves an existing row
alone**, where every other consumer in the platform upserts. A replayed event
overwriting a projection is harmless. A replayed event overwriting a
membership would silently undo a role change someone made on purpose, and
would bump the version other services will eventually compare against.

And a lost event is not recoverable by replay. Publishing is best-effort with
no outbox (ADR 0006), which is fine when everything downstream can be
rebuilt. Here it means a user who registers during a broker outage ends up
with no membership and no automatic way back.

### Memberships for users who already existed

This is the finding that changed what phase 1 could deliver, and it was
correctly flagged mid-sprint before anything was built.

The consumer only reaches users who register from now on. The existing ones
live in `helpdesk_auth`, ADR 0003 forbids organizations-service from reading
another service's database, and auth-service exposes no user-listing endpoint
— a gap `data-ownership.md` had already recorded as theoretical and which is
now load-bearing.

So reconciliation is an operator script,
`infrastructure/postgres/operations/backfill-bootstrap-memberships.sh`. It
reads one database and writes another, which is a thing a migration may do
and a service may not. It only inserts, never updates or deletes, and
`ON CONFLICT DO NOTHING` on the unique pair makes a second run a no-op.

Being re-runnable is not a convenience — it is also the recovery path for the
lost-event case above, which has no other one.

The alternative I rejected was auto-provisioning a membership at mint time
when none exists. It self-heals with no operator step, and it would have been
the shorter path. It also installs a rule that says "anyone who can
authenticate gets a membership in the bootstrap organization", inside the
authentication path, in a system whose entire point is about to become that
belonging somewhere is not automatic. That is a rule nobody would be able to
remove later without wondering what depended on it.

### Seeding, and why it is a migration

The bootstrap organization is inserted by its own migration. There is no seed
mechanism in this repository — no `prisma/seed.ts` in any service, no
`migrations.seed` key in `prisma.config.ts` — and `prisma migrate deploy` is
the only provisioning step that runs both on a developer's machine and in CI.
Inventing a seed runner that CI does not execute would have given the two
environments different data, which is a worse problem than a data row living
in a migration.

Its id is fixed and obviously synthetic (`00000000-0000-4000-8000-000000000001`)
so that every environment names the anchor the same way, and so that a reader
who later finds it in a foreign key can tell at a glance that it is the
anchor rather than an ordinary organization.

### Provisioning, in both places

R10 warned that a new database and role must be added by hand in two
unsynchronised places. It is worse than that: `ci.yml` needs **two**
independent edits, the role-and-database creation and the integration-test
invocation. Forgetting the second one would not fail anything — the new suite
would simply never run in CI, and nobody would notice.

The init script only executes on first initialization of an empty volume, so
the local database was provisioned by hand with `psql` rather than by
destroying the volume, which would have deleted every local database. The
script was still edited, for a clean checkout.

## Phase 2 — tenant context in the token

auth-service resolves the caller's membership while minting a token and
stamps `org`, `perms` and `mv` into it. Every downstream service receives the
claims and ignores them.

Nothing needed to change in `libs/security` for the claims to arrive intact,
and I checked that four ways rather than assuming it: the guard assigns the
whole decoded payload to `request.user`, no zod or class-validator sits on
the token path, no `JwtModule.register` in the platform verifies `audience`,
`issuer` or `algorithms`, and `ValidationPipe` only ever sees body, query and
param DTOs. `iat`, `exp` and `iss` already flow into `req.user` today without
being declared, which is the proof by precedent.

`Actor` and `AccessTokenPayload` gained the fields as **optional**. Making
them required is what points the compiler at every authorization call site
that has not been updated — but that only works once the duplicate local
copies of `Actor` in tickets-service and users-service are deleted, and that
is the read-path phase. Requiring them now would have hidden the very call
sites the change exists to surface.

### The first service credential in the platform

auth-service made no outbound HTTP call before this sprint. The one existing
service-to-service pattern does not transfer: ai-service forwards **the
caller's own bearer token** and holds no credential of its own, and minting a
token is precisely the moment when the caller has none.

So `INTERNAL_SERVICE_TOKEN` is a shared secret in a header, validated by a
guard that does a constant-time comparison, on an endpoint the gateway does
not route.

It is deliberately **not** `JWT_ACCESS_SECRET`. Reusing that key would make
one symmetric secret stand for both "this person is authenticated" and "this
process is authenticated", so rotating either meaning would force rotating
the other.

It also has **no default**, and is optional rather than required. A default
would have been a guessable credential committed to a public repository —
which is the reason `JWT_ACCESS_SECRET` has none either. Leaving it unset
means auth-service does not attempt resolution at all and mints tokens
without tenant claims: the same outcome as a failed call, reached without
inventing a secret.

ADR 0011 rejected a service credential for ai-service and said one "must be
introduced together with the audit and rotation story it deserves". That
story is still not built. SECURITY.md says so rather than implying otherwise.

### Failing open, deliberately, and only for now

ADR 0014 says login fails when organizations-service is unavailable. The
implementation does not do that. It mints the token without the claims and
logs a warning.

The reason is sequencing, and I would rather write it down than have it read
as an oversight. No service reads the claims yet. Failing closed today would
turn a service nobody depends on into a single point of failure for every
login in the platform, in exchange for protecting nothing at all. The trade
reverses the moment write paths start setting the organization from the
claim — at that point a token with no tenant context is a token that must not
be issued.

The warning is the part that matters between now and then. A resolution that
keeps failing has to be visible before it becomes fatal, not discovered on
the day it does.

ADR 0014 has been updated with this, so the ADR and the code do not disagree
silently.

### `perms` is empty, and that is the honest value

Role templates are still plain strings. The template-to-permission rows
ADR 0015 requires arrive with the evaluator, in the read-path phase.

An empty set means a call site that starts checking permissions denies, which
is the safe direction to be wrong in. Filling the claim with invented
permissions so it looked finished would have been the unsafe one, and would
have created a second source of truth for a matrix that has not been agreed
yet — ADR 0015 lists eight role templates in lowercase prose while
`tenancy-target-state.md` lists nine in another convention, including a
platform-scoped one. That contradiction is unresolved and does not need
resolving until rows exist.

### A decision ADR 0014 left open, now closed

**A session belongs to a person, not to a workspace.** `refresh_tokens` keeps
its user-only key and gained no column.

What decided it was reuse detection rather than the conceptual argument.
`RefreshSessionUseCase` already revokes every session a user has when a
rotated-out token comes back. A per-organization session would force that to
decide whether a token stolen from one workspace should kill the others, and
the safe answer is yes — which is what a per-person session does already,
with no column to reason about.

## Verified

The full gate, green: `format:check`, `lint` (15 projects, 0 errors, 9
pre-existing warnings), `typecheck` (14 projects), `test` (15 projects),
`build` (15 projects). Nine integration suites against real PostgreSQL and
RabbitMQ, up from eight.

Unit and integration specs are the floor, not the proof. What I actually
checked, with both services running against the real broker and real
databases:

- Registering a user produced `user.registered.v1`, the consumer created a
  membership in the bootstrap organization, and logging in returned a token
  carrying `org=00000000-0000-4000-8000-000000000001`, `perms=[]`, `mv=1`.
  Refreshing that session carried the same three claims — which is what
  bounds membership staleness to one access-token TTL.
- With organizations-service **stopped**, login and refresh both still
  returned 200, the tokens carried no tenant claims, and auth-service logged
  the warning. That is the fail-open path, observed rather than reasoned
  about.
- The registration published during that outage was held by the durable queue
  and became a membership when the service came back: 13 users, 13
  memberships. So an outage costs the tenant claims on tokens minted during
  it, and costs nothing permanent — the two failure modes are independent,
  which I had assumed and had not checked.
- The backfill turned 11 pre-existing users into 11 memberships, mapped
  2 to `organization_admin` and 9 to `requester`, and a second run changed
  nothing. Zero duplicate `(organization_id, user_id)` pairs.

### Remotely, after the merge

`main` was fast-forwarded to `4cb62a2` — no merge commit, no rewritten
history — and pushed. GitHub Actions run `30564325494` was green on its first
attempt, with the same counts the local gate reported and all nine integration
suites against real service containers.

That run is what actually closes R10 rather than merely claiming to. The
provisioning half of the risk fails loudly if you get it wrong, so it proves
itself; the `test-integration` invocation does not, and the only way to know
it landed was to watch the ninth suite run in the log. Sprint 9.0's lesson
holds — green locally and green on a fresh clone are separate claims, and an
untracked empty `src/assets` was enough to separate them once.

## What this sprint deliberately did not do

No `organization_id` on any table. No event contract versioned. Nothing in
analytics or audit, which cannot be scoped until the envelope carries a
tenant. No change to `canView`. No membership lifecycle — invite, activate,
suspend, deactivate — and so no membership events, which would also have
changed what the audit firehose records.

`isStaff` is still defined four times. Deleting it is the read-path phase,
and it has to land in one change or the copies drift.

## Known limitations

- **`mv` is emitted and never checked.** Nothing re-validates a membership
  version, because nothing yet performs an operation where a stale claim
  would matter. ADR 0014's own re-validation idea has an unresolved tension
  with its rule that downstream services never call organizations-service
  synchronously; that needs settling before any high-consequence operation
  relies on `mv`.
- **The internal credential has no rotation and no audit trail.** It is one
  shared secret in two `.env` files.
- **There is no organization selector**, so resolution picks the oldest
  active membership in an active organization. That is deterministic, which
  is what matters while there is exactly one organization; it is not a
  product rule.
- **Nothing is deployed.** As with every previous sprint, this runs locally
  and in CI and nowhere else.

## Documentation

Meaningfully improved: `data-ownership.md` now distinguishes rebuildable
projections from the first store in the platform that is not one, and
documents the backfill as a reconciliation procedure rather than a rebuild;
`messaging.md` records the third consumer of `user.registered.v1`;
`service-boundaries.md` and `system-context.md` record the one new
synchronous edge and that no other service gained a dependency;
`local-development.md` gained the ninth service and the fact that it is not
required for login; `docs/api/auth-service.md` describes the three claims and
says plainly that `perms` is empty and why. ADR 0014 gained what
implementation changed, ADR 0013 gained what actually exists of the eight
tables it describes, and ADR 0011's rejection of a service credential now
points at the one that exists and why it does not contradict it.

Removed or corrected: stale service, database and project counts across
README, SECURITY.md and the public engineering page, several of which were
already wrong before this sprint rather than made wrong by it.

Historical records were left alone: `tenancy-current-state.md` still
describes the pre-migration state it was written to describe, and no earlier
sprint report was edited.

No fictional experience, employer, customer, production incident, user
research or external approval appears anywhere in this sprint's writing, and
nothing is described as available, deployed or production-ready.
