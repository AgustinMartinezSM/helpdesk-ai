# Sprint 9.8 — Invitations and the public face of organizations-service

Status: **Implemented and verified locally (2026-08-02).** The Definition of
Ready below was written and checked before any code; the outcome record at
the end says what landed against it. This sprint carries the structural
change that was deferred in 9.5, 9.6 and 9.7 — organizations-service stops
being a service only other services can reach — so the DoR spends its first
decisions on that rather than on the feature.

## Definition of Ready

**Previous dependency complete.** Sprint 9.7 is merged with remote CI green
(`bde30eb` at the time of writing). Everything invitations need already
exists on the substrate side: memberships with role templates and a version
(9.2), the permission evaluator and `Actor` (9.4), branches and the
membership lifecycle events (9.5), the directory projection those events
feed (9.5/9.6).

**Real state known, and it is the part worth reading twice.** Four places in
the repository assert, in prose, that organizations-service has no
person-facing surface, and this sprint falsifies all four:

- `apps/organizations-service/src/app/app.module.ts:66` — "No JwtModule:
  this service has no person-facing endpoint yet."
- `apps/organizations-service/src/config/env.ts:25-30` — "this service
  verifies no user tokens — it has no person-facing endpoint — and a process
  identity should not rest on the key that signs people's sessions."
- `apps/organizations-service/src/main.ts:35-37` — "this service is
  deliberately absent from the api-gateway's routing table: only auth-service
  calls it, server to server. Browsers have no path here at all."
- `SECURITY.md:19` — "What the credential opens is on a service deliberately
  absent from the api-gateway routing table — a browser has no path to it."

That last one is not a comment; it is a load-bearing clause in the security
argument for `INTERNAL_SERVICE_TOKEN`. Half of why the missing rotation
story has been acceptable is that nothing outside the cluster could reach the
host at all. Opening a public route on that host removes that half, which is
why this sprint pays part of the credential debt rather than only noting it
again (D9).

What does NOT exist: any invitation of any kind, anywhere; any way to add a
person to an organization except registering (which lands them in the
bootstrap organization) or an operator running the internal membership
endpoints with the shared service credential; any outbound delivery
capability at all — no SMTP client, no mail provider, no template renderer,
no scheduler, no job runner, no cron. `notification-service` writes in-app
rows that require a `ticket_id` and address a `user_id`, so a notification to
someone who has no account is not representable.

### Product objective

An organization admin brings a colleague in: they choose the person and the
role, the product gives them something to hand over, and the person ends up
signed in as themselves with the intended permissions. Nobody shares a
password, nobody is added by an operator running SQL, and every step is
attributable to the person who took it.

### User stories and acceptance criteria

1. **An admin invites a person to their organization.** `people.invite`
   holders POST an email address and a role template and receive a one-time
   code, once, in that response. The invitation is scoped to the admin's
   organization from the token, expires in seven days, and cannot grant more
   than the admin holds. Done when an admin of org A cannot issue into org B
   by any parameter, and cannot issue a template whose permissions exceed
   their own.
2. **The invited person claims it and lands in the organization.** They sign
   in (registering first if they have no account, choosing their own
   password — the admin never sees one), POST the code, and their next token
   carries that organization's `org`, `perms` and `mv`. Done when the walk
   registers → signs in → accepts → refreshes → reads the organization,
   against real PostgreSQL, and when a person who already had an account
   takes the same path with no second account created.
3. **The code is single-use, expiring and revocable.** Two concurrent
   acceptances produce exactly one membership; an expired code is refused; a
   revoked one is refused; an admin can list their organization's invitations
   with status and see which have expired. Done when the race is pinned by a
   test that issues two parallel acceptances against a real database and
   asserts one success, one refusal and one membership row.
4. **A wrong code is not an oracle.** An unknown invitation id and a valid id
   with a wrong secret answer identically; an invitation belonging to another
   organization is not found rather than forbidden; an invitation whose
   issuer has since lost standing, or whose organization has since been
   suspended, is refused with one message that does not say which. Done when
   the adversarial suite covers each case across two real organizations.
5. **organizations-service is reachable by a person, safely.** The gateway
   routes `/api/organizations/*`, the service verifies access tokens, every
   route checks a permission key and a tenant, `/internal/*` keeps the
   service credential and gains a header that cannot be smuggled in from
   outside. Done when a request carrying `x-internal-service-token` through
   the public edge cannot reach an internal route.

### Technical scope (decisions D1–D10)

- **D1 — organizations-service gains its public face, and this reverses
  Sprint 9.5's D6 explicitly.** One more gateway mount,
  `/api/organizations` → `/organizations`, following the shape the other
  seven already use rather than inventing a narrower one;
  `JwtModule.register({ secret: env.JWT_ACCESS_SECRET })` for verification
  only (this service never signs); `JwtAccessGuard` as a plain provider, not
  an `APP_GUARD`, so `/internal/*` keeps its own guard and nothing else
  changes meaning; `.addBearerAuth()` on the Swagger builder. The four prose
  assertions quoted above get rewritten in the same change, because a comment
  that has become false is worse than no comment. Recorded in **ADR 0019**
  with the alternatives that lost.
- **D2 — The gateway strips `x-internal-service-token` on the way in.** Today
  the proxy forwards every header verbatim and that is safe because the only
  host with an internal surface is unroutable. From this sprint it is
  routable, so the strip is what preserves the property the design already
  depended on. One line in `service-proxy.ts`'s `on.proxyReq`, plus a test
  that sends the header at the public edge and asserts it does not arrive.
  This is a change to the shared proxy, so it applies to every service — no
  caller has any business presenting a service credential from outside.
- **D3 — The invitation lives in organizations-service, in
  `helpdesk_organizations`.** Acceptance has to consume the code and create
  the membership together or not at all, the membership row is in this
  database, and there is no outbox (ADR 0006) and no consumer retry — so any
  design that puts the invitation elsewhere turns a crash into a burned code
  with no membership and a person locked out of the only path they were
  given. ADR 0013 also already assigns this service the invite → activate →
  suspend → deactivate lifecycle, and auth-service has to stay identity-only:
  an invitation names a role template, which is exactly what auth-service is
  not allowed to know.
- **D4 — There is no admin-created account in this sprint, and the sprint
  name is half wrong on purpose.** An account whose row exists before the
  person acts needs `password_hash` to be nullable — it is `TEXT NOT NULL`
  and every read path calls `argon2.verify` against it — plus a set-password
  credential with its own expiry, single-use and recovery story, plus a
  `UserRepository` that can update at all (it exposes `findByEmail`,
  `findById` and `create`). The one cheap escape, a placeholder hash, is a
  permanent shared password wearing a different name, which ADR 0016 forbids
  outright. And the credential would still have to reach the person, which
  lands on the delivery decision ADR 0008 explicitly left to the project
  owner. So what an admin creates is **access**, not an account: the person
  creates the account when they claim the invitation, choosing their own
  password. The admin never sees, sets or can recover it, which is a stronger
  guarantee than "the temporary password is not permanent" — and it is the
  only version of this feature the repository can deliver honestly today.
- **D5 — The code is `<invitationId>.<secret>`, and only its hash is
  stored.** 32 random bytes, base64url, with the invitation id in front so
  lookup is an O(1) read by primary key and nothing ever indexes on secret
  material — the same split `refresh-token.codec.ts` already uses, for the
  same reason. The row keeps `sha256(secret)`; comparison is
  `timingSafeEqual` behind a length check. Single use is an atomic
  conditional `UPDATE ... WHERE id = $1 AND status = 'pending'`: zero rows
  affected means someone else won the race, and the loser gets a conflict
  rather than a second membership. Expiry is seven days, a domain constant
  and not configuration — a security window with two sources of truth drifts.
- **D6 — Acceptance is authenticated, and the addressee comes from the signed
  token.** `POST /organizations/invitations/accept` requires a valid access
  token but no permission key and no organization — holding the code while
  being the addressed person IS the authorization, the same shape as
  `PATCH /users/me`. The email is read from the `email` claim, which
  auth-service signs, never from the request body. This is what makes an
  anonymous acceptance endpoint unnecessary, and refusing to build one is
  deliberate: an unauthenticated endpoint that creates accounts and mints
  sessions, on a platform whose gateway and BFF throttle nothing
  (`SECURITY.md:58`), is an account-takeover path whenever the invited
  address already belongs to someone — and the person who chose that address
  is the admin. auth-service gains zero files this sprint, which is the
  single best measure of this decision.
- **D7 — An invitation cannot grant more than its issuer holds, checked
  twice.** The requested template's permission set must be a subset of the
  issuer's, read from the issuer's **stored membership row** rather than from
  the token — `JWT_ACCESS_TTL_SECONDS` defaults to 900, so a demoted admin
  keeps their old claims for a quarter of an hour. `owner` is refused
  outright by constant, because `TEMPLATE_PERMISSIONS` maps `owner` and
  `organization_admin` to the same set today and the subset check alone would
  therefore let an admin mint a peer at the top template. The check runs
  again at acceptance, against the issuer's standing and the organization's
  status at that moment: an invitation must not outlive the authority that
  created it for seven days. A refusal for any of these reasons is one
  generic conflict, blind to the cause — the same rule the assignee
  validation settled in 9.4, for the same reason: distinguishing them leaks
  membership facts to someone who is not a member yet.
- **D8 — Which membership wins the mint, and what that costs downstream.**
  Resolution returns the oldest active membership, and a person who registers
  in order to accept an invitation gets a bootstrap membership from the
  registration consumer first — so without a change, acceptance is invisible
  and the whole feature does not demonstrate. Resolution therefore prefers
  the first eligible candidate whose organization is not the bootstrap one,
  falling back to the oldest eligible when there is none. Nothing is deleted
  and no membership is retired: the bootstrap organization is migration data,
  `deactivated` is terminal, and the real answer to "which organization am I
  acting in" is the organization selector already deferred (ADR 0014).
  **Two consequences are accepted rather than fixed, and both are named
  here because they are now reachable in normal use**: an accepted invitee
  stays visible in the bootstrap organization's directory, and
  analytics' `user_snapshots` is keyed on `userId` alone, so a second
  membership event would move that person's snapshot between tenants. The
  move is a race decided by broker delivery order, and that part is not
  acceptable, so `applyMembershipCreated` stops clobbering an organization a
  previous event already stamped — the same care its registration path
  already takes. What remains is a stable, documented limitation: analytics
  counts a multi-organization person in the first organization that claimed
  them, and counting them in both needs `user_snapshots` rekeyed, which is
  its own increment.
- **D9 — `INTERNAL_SERVICE_TOKEN` becomes rotatable; attribution does not
  land.** The verifier accepts a second, optional value
  (`INTERNAL_SERVICE_TOKEN_PREVIOUS`, no default, same 32-character
  minimum), compared in constant time against both without early return, so
  a rotation is: add the new value as PREVIOUS everywhere, promote it, drop
  the old one — with a runbook in `SECURITY.md` saying exactly that. That
  plus D2's header strip is the part of the debt this sprint can close
  responsibly. What does **not** land is the audit half, and the reason is
  worth writing down rather than deferring silently: recording _which
  process_ called requires the credential to identify the caller, which means
  per-caller secrets (the guard learns the caller from which value matched)
  or a self-signed service assertion. Both are credential designs with their
  own env surface, revocation and rollout; bolting a self-declared caller
  header onto a shared secret would record a claim the credential does not
  bind, which is decoration. Per-caller credentials are named in `SECURITY.md`
  as the next step, and the item stays open.
- **D10 — Three new tenant-carrying contracts, no version bump anywhere.**
  `invitation.issued.v1`, `invitation.accepted.v1`, `invitation.revoked.v1`,
  each carrying the organization on the envelope and naming the actor who
  took the step, with `roleTemplate` as a plain string (never an enum — the
  template vocabulary is still open and a schema must not freeze it).
  **No payload carries the code, the code hash, or the invitee's email
  address**: audit-service binds the firehose with `#` and stores payloads
  opaquely and indefinitely, so an address in a payload is an address kept
  forever — the same reasoning that keeps values out of `profile.updated.v1`.
  `audit-service`'s `isTenantCarryingEventType` gains the `invitation.`
  prefix in the same change, or a publisher that omitted the envelope tenant
  writes an audit row no tenant-scoped read can ever match.
  `membership.created.v1` is reused unchanged when acceptance actually
  inserts a membership, so the directory projection needs no users-service
  change at all; the reuse widens what that event means for its two existing
  consumers, which is why D8 exists. No `retiredBindingKeys` literal is
  touched.

### Security boundaries

- The code is shown in exactly one HTTP response and never appears in a path
  segment, a query string, a log line, an event payload or a stored column.
  Only its hash is persisted.
- Unknown id and wrong secret answer identically; a foreign organization's
  invitation is not found rather than forbidden. Existence is not confirmable
  by anyone who does not already hold `people.invite` in that organization.
- The addressee is the signed `email` claim. A body field would let the
  holder of a leaked code choose who they are.
- Privilege cannot travel upward: subset check against the issuer's stored
  row, `owner` excluded by constant, both re-evaluated at acceptance.
- `/internal/*` keeps `InternalServiceGuard` and its own credential;
  `JWT_ACCESS_SECRET` and `INTERNAL_SERVICE_TOKEN` stay separate variables
  and neither opens the other's routes. The gateway strips the internal
  header inbound.
- **Accepted, and stated rather than implied**: `mv` is minted and read by
  nothing. Revoking a wrongly issued invitation after acceptance, or
  suspending the resulting member, leaves that person's access token valid
  until it expires — up to `JWT_ACCESS_TTL_SECONDS`, 900 by default. Nothing
  in this sprint closes that window, and no route in it should be described
  as taking effect immediately.
- **Accepted**: the code's confidentiality is only as good as the channel the
  admin chooses, because the platform sends nothing (D4, and the delivery
  note below). Seven days and single use are what bound the exposure.

### Delivery, stated plainly

The product cannot send an email, and this sprint does not pretend otherwise.
ADR 0008 recorded that there is no provider and no transactional credential,
that adopting one needs the project owner's explicit approval, and that a
superseding ADR must name which provider and why. That approval does not
exist, so the invitation is delivered out of band by the admin who issued it.
No `sent_at` column, no delivery status, and no interface copy anywhere may
say the invitation was sent — that would be exactly the lie ADR 0008
rejected option B for.

### Migration impact

One migration, in `helpdesk_organizations`: `invitations`, with a real FK to
`organizations`, an index on (organization, status, created_at) and a partial
unique index on (organization, invitee_email) `WHERE status = 'pending'` so
"one pending invitation per address" is enforced by the database rather than
by a check that races. Written as raw SQL because Prisma's schema language
cannot express a partial index, with the reason in the migration and beside
the model. No auth-service migration, no users-service migration, no NOT NULL
added anywhere. `invitations` is authoritative and **not** rebuildable from
events — the hash is in no event and cannot be — so `data-ownership.md` gains
it in the non-rebuildable category, and the existing `organizations /
memberships` cell is corrected in the same pass: it currently promises a
reconciliation script, and an invitation has no reconciliation path and
cannot have one. Rollback is a code revert plus dropping the table, except
for memberships created by acceptance in between, which are ordinary
memberships and stay.

### Test strategy

Unit on the code codec, the expiry and single-use logic, the subset ceiling
and the view shapes, with fakes that honour organization scope (R2 — a double
that ignored the scope would pass a suite against a repository that leaks).
Integration against real PostgreSQL for the full walk, the parallel-acceptance
race, revocation, expiry, and the adversarial matrix across **two real
organizations** — which is the first time this service's suite needs two,
since the bootstrap organization arrives from a migration and today's teardown
deletes only memberships. R9's shared fixture module is still unbuilt
repo-wide; this sprint pays it for organizations-service only, with a scoped
fixture that creates and tears down both organizations in dependency order
(the new FK makes teardown order load-bearing here for the first time), and
the repo-wide module stays owed. Gateway-level test for the header strip.
Full gate plus all nine integration suites before push.

**One hole, named rather than papered over**: CI's workflow env block sets
only `DATABASE_URL`, so no suite exercises `INTERNAL_SERVICE_TOKEN` across a
real process boundary — including after D9 changes how it is compared. The
rotation logic is covered at unit level against both values and the
cross-process hop stays uncovered, exactly as it is today.

### Explicitly out of scope

Any UI — web-bff routes and `apps/web` pages are Block B, and this sprint
ships an API the way 9.5 and 9.6 did. Anonymous acceptance and every
auth-service change with it (D6). Provisioned accounts with a set-password
credential (D4 — blocked on a delivery decision, not on effort). Email
delivery and any provider (ADR 0008). `people.create`, `people.suspend`,
`people.assign_roles`, `people.import` and the public membership-lifecycle
routes — each needs a call site this sprint does not have, and a key in a
token that nothing checks is a claim nothing can falsify. Public branch-edge
routes: assigning an invited branch manager to their branches still goes
through the internal operator endpoint, which is an attribution gap this
sprint does not close and 9.9 should. Bulk/CSV import (9.9). Seeded
role-template rows (the vocabulary question is still open). Rekeying
`user_snapshots` (D8). Per-caller service credentials and internal-call audit
events (D9). Organization selector and token exchange (ADR 0014).

### Ready?

Dependency complete, and the state is known down to the four comments this
sprint has to rewrite. The structural decision has its own ADR and its
alternatives written down. The feature is additive: one table, one gateway
mount, one permission key, three contracts, no schema change outside its own
database. The two things that turned up while writing this — the bootstrap
membership deciding which organization a new invitee lands in, and the
analytics snapshot moving between tenants — are decided in D8 rather than
discovered during implementation, which is what the DoR is for. The
sprint's own name is corrected in D4 instead of being delivered dishonestly.
Proceeding under the standing autonomous authorization.

## Outcome record (2026-08-02)

Two commits: the opening (`1b691f5` — this DoR and ADR 0019) and the
implementation (`25203f0`). Every acceptance criterion holds.

**The structural change landed as decided, and nothing else changed meaning.**
`/api/organizations` is the eighth gateway mount, organizations-service
registers `JwtModule` for verification only, and `JwtAccessGuard` is a plain
provider — so the `/internal/*` controllers kept `InternalServiceGuard`
untouched and no existing route gained or lost a check. The four prose
assertions the DoR quoted are rewritten, `SECURITY.md`'s paragraph with them.
The one shared thing that moved is the error filter: it left `app/internal/`
for `app/`, because it now serves both surfaces.

**The gateway strips the service credential.** One line before
`fixRequestBody` (which writes the body and can end the request, so order
matters), plus two tests: the header does not arrive downstream, on the
organizations route and on an unrelated one, and the body still does.

**Single use is a database guarantee, not a code convention.** An integration
test issues one invitation and redeems it twice in parallel against real
PostgreSQL: exactly one succeeds, exactly one is refused, exactly one
membership row exists. The partial unique index is proved the same way — a
second pending invitation for the same address is refused, while the _same_
address may be pending in two organizations at once, and an address can be
re-invited once its previous invitation is settled.

**Privilege does not travel upward, and the ceiling is read twice.** A test
asserts the premise the `owner` exclusion rests on — that `owner` and
`organization_admin` resolve to the same permission set today — so the day
that stops being true the test says so rather than the exclusion quietly
becoming redundant. Another builds the exact shape a demoted admin still
holds: a token carrying `people.invite` over a stored template that does not,
and watches the stored row win. The redemption-time re-check is covered for
all three of its cases (issuer deactivated, issuer demoted below the invited
template, organization suspended), each collapsing into the same refusal.

**The refusals leak nothing.** Unknown id, wrong secret and a malformed code
answer identically; another organization's invitation is not found rather
than forbidden, and stays pending after the attempt. The one deliberate
exception is the addressee mismatch, which is named — someone signed in with
the wrong one of their own accounts is the common case, and whoever holds the
code already knows it is real.

**D8's two consequences are closed as decided.** Resolution prefers a real
organization over the bootstrap one; three tests pin it as a tiebreak rather
than a filter, including the legacy user whose only membership is the
bootstrap one. analytics' membership stamp no longer moves a snapshot between
tenants.

### What the implementation decided that the DoR had left open

- **The addressee mismatch is its own refusal, not the generic one.** The DoR
  only required that expired / revoked / used / issuer-lost-standing /
  organization-suspended be indistinguishable. Folding the addressee check in
  with them would have made "you are signed in as the wrong person" — the most
  likely honest mistake — unanswerable, in exchange for hiding a fact the
  code-holder can already deduce.
- **`invitation.accepted.v1` carries `membershipId` as OPTIONAL.** Someone who
  already belongs consumes their invitation without a new row, and the first
  draft would have named a membership id that did not correspond to anything
  created. The event now omits it, and a contract test pins that the payload
  validates without it.
- **The accepting user id is passed to the publisher rather than read off the
  row.** The domain type makes `acceptedByUserId` nullable — a pending
  invitation has none — and the adapter's first version coerced the null to an
  empty string, which would have published an event failing its own `z.uuid()`
  at the broker and been swallowed by the best-effort catch. Passing it
  explicitly, like `revokedByUserId`, makes the nullable case unrepresentable.
- **The "no address on the bus" guarantee is pinned at the contract, not at
  the publisher fake.** The first version asserted it against the in-memory
  publisher, which records the whole domain object — so it was testing the
  fake, not the payload. It moved to `contracts.spec.ts`, where zod's
  stripping of undeclared keys is what actually enforces it.

### Fixed while in the same files

Two pre-existing gaps, both the same class of bug as something this sprint was
already closing, both in files it was already editing:

- `branch.*` and `station.*` were missing from audit-service's
  born-tenant-carrying list. Their `.v1` is tenant-carrying like
  `membership.*`, so a structure event published without an envelope tenant
  would have recorded with `organization_id = NULL` — invisible to every
  tenant-scoped read — instead of dead-lettering inspectably. The list is now
  a named constant, with `profile.*` explicitly excluded and the reason given.
- `/api/ai` was mounted at the gateway but absent from the proxy spec's
  service table, so one existing route had no routing coverage. Added
  alongside the new one.

### Verified

organizations-service: 174 unit tests across 7 suites (the invitation matrix,
the grant ceiling both ways, the refusal shapes, the resolution tiebreak, the
credential rotation) plus 18 integration tests against real PostgreSQL across
three suites, including the parallel-redemption race and the two-organization
adversarial set. api-gateway 8 (routing plus the two header-strip tests),
messaging 69 (the invitation contracts and their payload-stripping guarantee).
The full gate — format, lint, typecheck, test, build — ran green across all 15
projects, and all nine integration suites passed locally against real
PostgreSQL and RabbitMQ. The migration is applied to both
`helpdesk_organizations` and `helpdesk_organizations_test`. Remotely, GitHub
Actions run `30769152405` on `0ecccd4` was green on its first attempt,
including the integration job against real service containers — which is where
the new migration ran on a database that had never seen it.

### Still true after this sprint, and worth restating

No UI exists for any of this; the API is the deliverable, as in 9.5 and 9.6.
Nothing is deployed. The platform still cannot send an email, so an invitation
reaches its recipient because an admin passed the code along — and the code's
confidentiality is only as good as the channel they chose. `mv` is still read
by nothing, so revoking after acceptance or suspending the new member leaves
their access token valid for up to `JWT_ACCESS_TTL_SECONDS`. Assigning an
invited branch manager to their branches still goes through the internal
operator endpoint, which is an attribution gap this sprint did not close.

## Documentation

Meaningfully changed this sprint: ADR 0019 (new — the public-surface decision
and the three alternatives that lost), `SECURITY.md` (the
`INTERNAL_SERVICE_TOKEN` paragraph, whose containment argument this sprint
falsified, plus the rotation runbook and a rewritten roadmap item that says
what attribution would actually require), `data-ownership.md` (the
`invitations` row and its narrative — the first data here that is not even
reconcilable — and a correction to the `organizations`/`memberships` cell,
which promised a reconciliation script that only covers bootstrap
memberships), `tenancy-migration-plan.md` (R9 partially paid and R11's strip
half delivered), `README.md`'s ADR list (it had drifted two entries behind),
and this document. Removed: the four comments asserting organizations-service
has no person-facing surface, and the gateway health check's claim that it
routes to nothing. No fictional experience, customers, incidents or approvals
were introduced.
