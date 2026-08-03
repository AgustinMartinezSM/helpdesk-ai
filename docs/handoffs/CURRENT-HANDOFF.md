# Current handoff

**Date:** 2026-08-03
**Sprint:** 9.10 — member administration, implemented; 9.4-9.9 complete
**Repository:** `C:\Proyectos\helpdesk-ai`
**Branch:** `main`. `git log --oneline -20` is the source of truth for the
tip and for what is pushed; this file is for the things git cannot tell you.

Read `docs/progress/SPRINT-009.10.md` and **ADR 0021** first — membership
administration has four rules that are security rules rather than validation,
and one of them (nobody administers their own membership) is load-bearing in a
way that is not obvious from the code. Then 9.9 with **ADR 0020** (the browser
decides what to render from permissions, and every client gate rests on it),
then 9.8 with **ADR 0019** (organizations-service has a public face, which
reverses a property three sprints were built around and which SECURITY.md
leaned on), then 9.6 with ADR 0018 — users-service is no longer disposable. A
session that forgets any of these will document fiction.

## The migration is done. What that means concretely

**Authorization is permission-based end to end.** `Actor` is one type in
`libs/security`: `permissions` is required (an empty set is a decision, and
it denies), `organizationId` is deliberately optional — a token for an
account that belongs to no organization yet is a real minted state
(registration→membership is racy and the product preserves it), and the
refusal lives in `requireOrganization` at the domain boundary. `perms`
resolves from the membership's role template through the code map in
organizations-service; seeded template rows remain blocked on the
template-vocabulary question. The agent template carries three marked
interim widenings (`read_all`, `assign_agent`, flat `people.read`) that
shrink when branches and teams arrive.

**There is no `roles` claim.** Phase 8 removed it; the login/refresh/me
responses keep `user.roles` from the user row (display data — apps/web and
the BFF consume exactly that, verified). users-service dropped its projected
`roles` column. The `user.registered.v1` contract still carries roles and
organizations-service still reads them — mapping legacy roles into a first
membership is what that consumer is for.

**The database refuses an untenanted row** in seven tables (tickets,
ticket_comments, ticket_history, suggestions, ticket_snapshots, ticket_refs,
notifications). Two are nullable **by design**, not by omission:
`user_snapshots` (registration creates the row before the membership event
supplies the tenant) and `audit_events` (the firehose records the
structurally tenantless `user.registered.v1` forever). Their scoped reads
already exclude nulls, and the verifier prints their null counts as
informational. Rollback past phase 7 is a forward migration
(`DROP NOT NULL`), not a `git revert`.

**v2 is the only published revision of the five ticket/AI contracts.** The
v1 contracts are deleted; `user.registered.v1` lives on (anonymous facts
have no v2 to move to). Durable queues self-heal: subscriptions declare
`retiredBindingKeys` and every boot unbinds them idempotently — do NOT
remove those string literals until every environment's durable queue has
booted this version at least once, or a stale binding feeds the DLQ
indefinitely. Any environment with a v1 backlog at first boot will
dead-letter it as inspectable "no contract bound" letters; the v2 twins
already processed, so those can be purged.

**Everything else from phases 5–6 stands**: reads require the tenant from
the token, writes take it from the token, consumers dead-letter tenantless
tenant-carrying envelopes, notification compares tenant as well as id, the
directory is scoped through the `directory_memberships` projection, the
membership lifecycle publishes born-tenant-carrying events and bumps `mv`,
and assignment re-validates the assignee against live membership,
fail-closed (ADR 0014's amendment: high-consequence mutations may ask
synchronously, read paths never).

## Sprint 9.5 in one breath

The structure exists (branches/departments/stations with real FKs in
organizations-service, internal operator endpoints, born-tenant-carrying
events), the token carries the branch set (`br`, minted only when
non-empty; Actor.branchIds optional — absence denies), tickets validate
branch/station context against local projections fed by this service's
FIRST consumer (fail-closed 422, one generic message per concept), branch
visibility is live (read_all org-wide; read_branch = covered branches plus
own; branchless tickets deliberately invisible to branch managers until
routing exists), and the create-form pickers are served by tickets-service
(GET /tickets/branches — declared BEFORE ':id', a test pins the route
order). role-changed events keep the directory's template fresh. Department
rows exist but nothing keys on them yet, by scope. ADR 0016's amendment
records the dropped scope-qualifier experiment.

Three things NOT to do: do not add branch fields to ticket event payloads
(that is a v3 when a consumer needs it); do not make Actor.branchIds required
yet. The third — do not give organizations-service a JWT or a gateway route —
was 9.8's work and is DONE (ADR 0019); D6 of 9.5 is deliberately reversed.

## Sprint 9.6 in one breath

user_profiles is a HYBRID now (ADR 0018): identity seed projected, profile
columns source of truth — the registration consumer's upsert update-arm is
restricted to identity columns and a test pins that a replay cannot undo a
rename. Person-level self-edit lives at PATCH /users/me (no permission key;
works tenantless). Organizations define fields in users-service
(organization.update): stable immutable key AND type, both locale labels,
six types with closed declarative validation objects, archival retains
values. people.update edits members' values through the
directory-membership check. ONE view-filter decides visibility everywhere;
staff-only means invisible to the subject too, and a subject writing a
staff-only key gets 404, not 403 — a 403 confirms the key exists.
profile.updated.v1 carries changed keys, never values, and is NOT
tenant-carrying by name.

Three things NOT to do: never let a profile field near authentication (ADR
0017 — employee_number is an attribute, not a username); never write
profile columns from a consumer; never put field values in an event.

## Sprint 9.7 in one breath

The shared-terminal design is settled and documented (the five modes in the
sprint doc: individual login + remembered context built; PIN deferred until
a pilot proves the need; kiosk rejected as unattributable; manager sessions
rejected as impersonation). A login can declare the machine shared: the
refresh TTL drops to `JWT_REFRESH_SHARED_TTL_SECONDS` (capped by min() at
the normal TTL — the flag can only shrink), the BFF cookie carries no
Max-Age (dies with the browser), and ROTATION INHERITS THE BORN WINDOW
(expiresAt − createdAt of the presented token) so a shared session stays
short forever with no posture column. The web form remembers the PLACE in
localStorage (`helpdesk.station-context`, ids + labels, never identity —
ADR 0016), prefills, forgets on request, and drops stale/refused ids.

Two things NOT to do: never store a token or user id in the station
context; never make rotation read the TTL from env again — the born-window
derivation IS the posture.

## Sprint 9.8 in one breath

**organizations-service has a public face.** `/api/organizations` is the
eighth gateway mount; the service registers `JwtModule` for VERIFICATION only
and `JwtAccessGuard` as a plain provider, not an `APP_GUARD`, so `/internal/*`
kept `InternalServiceGuard` and nothing existing changed meaning. ADR 0019
records it and the three alternatives that lost. The gateway now STRIPS
`x-internal-service-token` from every inbound request — that strip is what
replaces the containment property SECURITY.md used to lean on ("a browser has
no path to it"), and it must not be removed.

**An invitation is not an account and not a credential for one.** Code is
`<invitationId>.<secret>`, only `sha256(secret)` is stored, constant-time
compare, single use via a conditional `UPDATE ... WHERE status='pending'`,
seven days, expiry DERIVED at read time because no scheduler exists anywhere
in the repo. Redemption consumes the code and inserts the membership in ONE
transaction — that requirement is the whole reason the table lives in this
service (no outbox, ADR 0006: a split write burns a code nothing can
regenerate). Accepting is authenticated but needs no permission and no
tenant; the addressee comes from the SIGNED `email` claim, never a body field.

**There are no admin-created accounts, and that is decided, not pending.**
`password_hash` is `TEXT NOT NULL`; a nullable column is its own sprint and a
placeholder hash is a permanent shared password by another name (ADR 0016).
The admin creates ACCESS; the person creates the account when they claim it.
Delivery is out of band by the admin — the platform can send nothing, and
ADR 0008 left adopting a provider to the project owner. No `sent_at` column,
and no copy anywhere may say an invitation was sent.

**Privilege cannot travel upward.** The requested template must be a subset of
the issuer's, read from the STORED membership (tokens outlive a demotion by
`JWT_ACCESS_TTL_SECONDS`, 900), and `owner` is excluded by constant because it
and `organization_admin` resolve to the same set — a test pins that premise so
it speaks up when it stops being true. The ceiling is re-checked at redemption
along with the organization's status.

**Resolution now prefers a real organization over the bootstrap one.** A
TIEBREAK, not a filter: everyone who registers lands in the holding pen first,
so oldest-first alone made an accepted invitation invisible; a legacy user
whose only membership is the bootstrap one still resolves to it.

Three things NOT to do: never let an invitation code reach a path segment, a
query string, a log or an event payload (one HTTP response, once); never turn
the generic redemption refusal into specific ones (it is blind to the cause on
purpose — the caller is not a member yet); never model expiry as a stored
status while nothing sweeps.

## Sprint 9.9 in one breath

**The browser stopped reasoning about roles.** The session carries
`permissions` and `organizationId`, echoed from the SAME membership resolution
that stamps the token's claims (ADR 0020) — not resolved again, so the two
cannot disagree about the moment they describe. `isStaff` is deleted; each of
its three gates checks the key its use case checks. The snapshot goes stale
with the token (900s, nothing compares `mv`), so a 403 MUST render as a real
message — that fallback is load-bearing, not defensive.

**Client gates are cosmetic, always.** `can(session, key)` in
`apps/web/src/lib/permissions.ts` decides what to RENDER. Every refusal
already lives in a use case (ADR 0015 rule 2). Never move a decision there.

**libs/security has a second entry point**:
`@helpdesk-ai/security/permissions`, the vocabulary alone, no imports. The
package root exports JwtAccessGuard — importing that from apps/web would pull
NestJS into the browser bundle. Keep the permissions module import-free.

**Three screens**: `/people` (directory + invitations + invite + revoke, gated
per section because listing invitations needs `people.invite` while the
directory needs `people.read`), `(public)/register`, and `/join`. Registration
does NOT sign anyone in at the BFF — the page chains register then login, so a
login failure after a created account is visible and recoverable.

**Accepting an invitation does not re-mint the token.** `/join` refreshes the
session after a successful accept; without that the person joins and still
appears to belong nowhere. A spec asserts the second refresh.

**An invitation can be previewed without being spent** (organizations-service,
new route): it names the organization and the role before an irreversible
accept, and it is the ONLY public place an organization's name is exposed. It
deliberately does not re-check the issuer's standing — that is a
redemption-time rule and a second copy would drift.

**The directory shows a role, not a status.** The listing already filters to
active members, so a status column would have said `active` on every row.

Three things NOT to do: never gate a client control on `session.user.roles`
(display data only); never let the BFF decide access — it forwards refusals
verbatim, and the 404-not-403 shapes ARE the security design; never render the
invitation code anywhere but the issue response it came from.

## Sprint 9.10 in one breath

**Every membership change is attributable to a person, and the path that was
not is deleted.** `ChangeMembershipRoleUseCase` and
`ChangeMembershipStatusUseCase` take an `Actor` and authorize themselves;
`organizations/memberships` is the public surface (role PATCH, status PATCH,
branch replace PATCH, branch GET) plus `organizations/branches` for the
picker. The status PATCH, role PATCH and branch PUT/DELETE left `/internal/*`
in the same commit — deleted, not deprecated (ADR 0016). A spec pins that they
answer 404 with the credential present. **The first administrator of a fresh
database now has to be made in SQL**, which is the intended consequence.

**Four rules, all reading stored rows** (ADR 0021): the requested template
must be grantable by the actor; the TARGET'S current template must be too, or
an admin could demote anyone; `owner` fails both by constant because the
permission map resolves it and organization_admin alike; and nobody
administers their own membership. That last one is why an organization can
never lose its last administrator — the actor must be active and hold the key,
and can never be the target. Do not "improve" it into a count-the-admins
query: that races, and this does not.

**Removal is `deactivated`, and deactivation is reversible now.** Its terminal
comment argued a new membership could be created instead; the unique index
made that impossible, and redemption skips duplicates, so re-inviting a
removed person told them they had joined and left them deactivated. The other
half of the argument (silent reactivation) died with the operator endpoint it
described. The edge is `deactivated → active` only.

**A defect the ceiling carried since 9.8 is fixed.** It compared raw
permission sets, and `branch_manager` holds `tickets.read_branch` where admins
deliberately hold `tickets.read_all`, so NOBODY could create a branch manager
through any surface. `domain/role-grants.ts` now expands the actor's reach
through a tiny implication table (`read_all` implies `read_branch` and
`read_own`) before the subset test. **That table is used by the ceiling ONLY**
— a service must never treat it as an authorization shortcut, because the
branch path also reads the `br` claim and means something different by an
empty set. Add a line when a new scoped read key lands; nothing fails loudly
if you forget.

**`GET /users` takes `?status=` and DEFAULTS TO ACTIVE.** The default is
load-bearing: the listing feeds assignee pickers as well as the People screen.
Only a caller holding an administration key asks for `all`.

Three things NOT to do: never let the implication table decide access; never
make the directory's default anything but active; never re-add an
unattributable membership write path, however convenient a break-glass would
feel.

## Things that will bite you if you do not know them

- **Resolution fails closed on uncertainty only**: cannot-ask → 503,
  belongs-nowhere → token without tenant claims, refused at writes with 403.
- **`INTERNAL_SERVICE_TOKEN` lives in three `.env` files** (auth, tickets,
  organizations). Since 9.10 the mutations it guards are the STRUCTURE ones
  (branch/department/station creation and editing) — the membership lifecycle
  moved to a person's token. Since 9.8 it is ROTATABLE
  (`INTERNAL_SERVICE_TOKEN_PREVIOUS`, accepted alongside the current value;
  runbook in SECURITY.md) and the gateway strips its header inbound. What is
  still missing is ATTRIBUTION: nothing records which process called, and
  closing that needs per-caller secrets or a signed service assertion — a
  self-declared caller header would log a claim the credential does not bind.
  tickets-service without the credential refuses every assignment with 503, by
  design.
- **`JWT_ACCESS_SECRET` is now required by organizations-service too.** Seven
  services verify with it, auth-service signs. A local `.env` from before 9.8
  will fail that service's boot with a named variable, which is the intent —
  and it did, on this machine, during 9.10's browser check. The symptom
  upstream is login answering 503 ("membership resolution failed: fetch
  failed"), which is the documented fail-closed behaviour for cannot-ask, not
  a bug. Add the variable with the same value auth-service signs with.
- **The role-template mapping is written twice** (backfill script +
  `roleTemplateFromGlobalRoles`) — change both in the same commit.
- **`backfill-tenant-columns.sh` refuses to run once a second organization
  exists** (R4). Feature, not bug. It now only matters for legacy rows in
  the two nullable-by-design tables.
- **The notification dev DB had a migration checksum reconciled by hand**
  (the phase-6 migration was edited after being applied locally). Any other
  machine that applied it pre-edit will see `migrate dev` complain once;
  `migrate deploy` (CI, tests) does not validate applied checksums.
- **Adding a service still means editing `ci.yml` twice.**
- **apps/web/specs is type-checked by NOTHING**: neither `tsconfig.json` nor
  `tsconfig.spec.json` includes it, so specs are transpiled by SWC and a type
  error there surfaces only as a runtime failure. Pre-existing; 9.9 added
  three files to the pile.
- **`refreshRequest` has no timeout.** With the BFF down, AuthProvider’s
  mount-time refresh never settles, so every authenticated route sits on its
  loading state forever instead of falling back to signed-out. Long-standing,
  visible on every page, and not 9.9’s or 9.10’s to fix.
- **`.claude/launch.json` now defines six dev servers**, but the preview tool
  caps a worktree at five running at once. The whole product needs all six
  (web, web-bff, api-gateway, auth, users, organizations), so a browser pass
  means starting five, then swapping one out — 9.10 signed in first and then
  traded auth-service for users-service, which works because a soft navigation
  does not re-mount AuthProvider and so does not refresh.
- **The first administrator of a fresh database has to be made in SQL.**
  Registration lands everyone on `requester`, and 9.10 deleted the operator
  endpoint that used to promote them. That is the intended consequence of
  removing an unattributable write path, not an oversight — but it is a real
  bootstrap step, and it belongs in whatever sprint builds organization setup.

## Work incomplete / deliberately deferred

- **Seeded role-template rows + the template-vocabulary/scope-qualifier
  decision** — the code map is the deliberate interim.
- **R9 beyond organizations-service**: 9.8 built a scoped two-organization
  fixture for that service only (its invitations table cascades, so teardown
  order became load-bearing). The other eight suites still teardown with
  unfiltered `deleteMany()`; the shared module is still owed.
- **`mv` is minted and bumped but nothing compares it** — narrowed on
  purpose to "cheap staleness signal" (ADR 0014 amendment).
- **No organization selector / token exchange**; resolution picks the oldest
  active membership, EXCEPT that a real organization now beats the bootstrap
  one (9.8, D8 — a tiebreak, not a filter). The selector is what retires that
  tiebreak.
- **analytics counts a multi-organization person in ONE organization** — the
  first to claim them. 9.8 stopped the tenant-move race (the stamp no longer
  overwrites), but `user_snapshots` is still keyed on `userId` alone; counting
  them in both needs the table rekeyed.
- **Attribution for internal service calls** (per-caller credentials) — the
  half of ADR 0011's story 9.8 did not close. Narrower since 9.10: what is
  left behind that credential is structure creation, not membership.
- **Branches, departments and stations are still created and archived through
  the operator endpoints.** 9.10 attributed branch ASSIGNMENT, not branch
  creation — `branches.create` and `branches.update` have no key and no
  screen. This is the setup story, not the onboarding one.
- **No transfer of ownership.** `owner` can be neither granted nor targeted,
  so an organization whose only privileged member is its owner cannot change
  that from inside. Refusing is the reversible half of a decision nobody has
  made; the operation is what would retire it.
- **`INTERNAL_SERVICE_TOKEN` stays optional in auth-service** (degrade-open
  with a boot warning): making it required would 503 the auth integration
  suite, which runs without organizations-service — revisit when the suite
  can fake the resolver at the boundary.
- Sprint 9.0 leftovers unchanged: AI usage ceilings, key rotation, rate
  limiting, `PRODUCT-ROADMAP.md`, provider-notice failure path,
  `feat/ai-service` branch deletion.

## Migrations (all applied locally, dev and _test)

Tenancy sprint: audit add_organization_index, analytics
scope_analytics_to_organization, notification scope_reads_by_organization,
users add_directory_memberships; enforce_tenant_not_null in tickets, ai,
analytics, notification; users drop_user_profile_roles. Sprint 9.5:
organizations branch_structure, tickets add_branch_context_and_structure_refs.
Sprint 9.6: users add_profile_fields. Sprint 9.7: none. Sprint 9.8:
organizations invitations (one table, a partial unique index in raw SQL —
do NOT "simplify" the Prisma model to @@unique, it would generate a total
index and make re-invitation impossible). Sprints 9.9 and 9.10: none.

## Tests executed (through 2026-08-03, local)

Every sprint closed with the full gate (format, lint, typecheck, test,
build) plus all nine integration suites against real PostgreSQL and
RabbitMQ, and a green remote CI run recorded in its sprint document: the
tenancy migration twice (phases 5-6, then 7-8), 9.5, 9.6, 9.7, 9.8, 9.9 and
9.10. The backfill sequence ran once, verified clean, and is recorded in
tenancy-phase-7-readiness.md.

9.10 also ran a manual end-to-end walk across six real processes (browser
client → web-bff → api-gateway → auth / users / organizations) covering the
whole administration surface and every refusal, plus a browser pass over the
People screen. Neither is automated; both are recorded in the sprint document
with what they showed.

**One hole worth knowing before trusting the suites**: CI's workflow env
block sets only `DATABASE_URL`, so `INTERNAL_SERVICE_TOKEN` is never
exercised across a real process boundary by any suite — including now that
9.8 changed how it is compared. The rotation logic is covered at unit level
against both values; the cross-process hop is not covered, exactly as before.

## Services required / environment variables

tickets-service wants `ORGANIZATIONS_SERVICE_URL` + `INTERNAL_SERVICE_TOKEN`
or assignment answers 503; users-service consumes membership events. New in
9.8: **organizations-service now requires `JWT_ACCESS_SECRET`** (same value
auth-service signs with) and optionally accepts
`INTERNAL_SERVICE_TOKEN_PREVIOUS` during a rotation; **api-gateway takes
`ORGANIZATIONS_SERVICE_URL`** (default `http://localhost:3010`). A local
`.env` from before 9.8 will fail organizations-service's boot naming the
missing variable, which is the intent. Every real `.env` is git-ignored.

## Exact next action

The next sprint is a product choice, and 9.10 changed which candidates matter:

1. **Organization setup: branches, departments and stations as a screen.**
   Now the sharpest remaining operator-only step, and the one 9.10 deliberately
   did not take. Assigning a branch manager to their branches is attributed;
   creating the branch they manage is still a curl by nobody in particular.
   Two keys already in the matrix (`branches.create`, `branches.update`), one
   service that already owns the rows, and the People screen's branch editor
   as the consumer proving the shape works. It is also what makes a fresh
   organization usable without a database client.
2. **Bulk/CSV import**, which 9.9 displaced and 9.10 did not touch. The people
   it loads now have a screen to appear on AND an administrator who can fix
   what the import got wrong — which is the argument that was missing before.
3. **Email delivery.** Unchanged and still the project owner's decision: ADR
   0008 requires explicit approval and a superseding ADR naming which provider
   and why. Until then an invitation reaches its recipient because an admin
   copied a code and passed it on — which the interface says out loud.
4. **The template vocabulary**, still blocking seeded role-template rows.
5. **Transfer of ownership**, new to this list: 9.10 refused `owner` in both
   directions rather than deciding what moving it should mean. Small, and it
   closes the one lockout the model still allows.

Short debt unchanged otherwise: R9 beyond organizations-service, per-caller
service credentials (the attribution half of ADR 0011), `mv` compared by
nobody, `user_snapshots` keyed on `userId` alone, `apps/web/specs` outside
type-checking, `refreshRequest` without a timeout.

## Resume commands

```bash
cd C:/Proyectos/helpdesk-ai
git branch --show-current      # expect main
git log --oneline -20
git status --short             # expect clean
docker compose up -d
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

## Suggested continuation prompt

> Continue HelpDesk AI. Complete and green on main: the tenancy migration
> (phases 0-8), Sprint 9.5 (branches/departments/stations with branch-scoped
> visibility), 9.6 (profiles and org-defined fields, ADR 0018), 9.7
> (shared-terminal sessions), 9.8 (invitations, and organizations-service
> gaining its public face — ADR 0019), 9.9 (the people-management surface, and
> a browser that decides what to render from permissions rather than role names
> — ADR 0020) and 9.10 (member administration, and the deletion of the last
> unattributable membership write path — ADR 0021). Read
> docs/handoffs/CURRENT-HANDOFF.md, docs/progress/SPRINT-009.10.md and ADR 0021
> before touching anything, and verify the repo state with git first.
>
> Pick the next sprint — the handoff's "Exact next action" lays out five
> candidates and what each unblocks. Organization setup is the sharpest one
> left: 9.10 made assigning a branch manager to their branches an attributed
> act, but creating the branch they manage is still a curl nobody can be
> blamed for, and a fresh organization cannot be made usable without a database
> client. Open whichever you choose with its own Definition of Ready, the
> pattern the last six sprints set.
>
> Standing rules: never a permanent shared password or unattributable request
> path (ADR 0016); profile fields never become credentials (ADR 0017); an
> invitation code lives in one HTTP response and never in a path, a log or an
> event; the redemption refusal stays blind to its cause; expiry stays derived
> while nothing sweeps; client-side permission checks decide what to RENDER and
> never what to allow (ADR 0015 rule 2 / ADR 0020); the BFF forwards refusals
> verbatim and decides no access of its own; keep libs/security's permissions
> module import-free; nobody administers their own membership and `owner` is
> refused in both directions (ADR 0021); the permission-implication table
> bounds grants and never decides access; the directory's default listing stays
> active-only; do not seed role-template rows (vocabulary still open); do not
> remove the retiredBindingKeys literals; do not remove the gateway's
> x-internal-service-token strip; rotation must keep deriving the born window.

## Repository isolation

This project is developed in isolation: work on it touches
`C:\Proyectos\helpdesk-ai` and nothing else. No code, pattern or
configuration is carried in from another repository on this machine, and
none was during this session. Verify the root with
`git rev-parse --show-toplevel` before starting, and stop if it differs.

---

# Writing standard for this repository

This section is a permanent instruction, not a note about one sprint.
Later sessions should keep applying it.

The repository should read as if a person maintains it by hand, because
one does. Use a natural, direct, technically serious voice: someone who
understands the decisions being made, explains them clearly, is still
learning from the project, prefers practical language over academic
language, and documents tradeoffs honestly.

**Never fabricate** professional experience, previous employers,
customers, production incidents, team discussions, user research,
external approvals, commercial adoption, or personal anecdotes that did
not happen. The goal is an authentic project voice, not a fictional
history. Do not mention the author's age.

## Code comments

Review comments when touching a file. A comment earns its place when it
explains why a non-obvious decision exists, which invariant is protected,
why a simpler-looking alternative was rejected, which security boundary
must not be bypassed, why a compatibility layer is temporarily required,
which failure case motivated the implementation, or what must stay true
during a future refactor.

Remove or rewrite comments that are robotic, overly verbose, obvious from
the code, generic, duplicated by a type or function name, written like an
AI explanation of syntax, or no longer accurate.

Not this:

> Initialize the service dependency.
> This function returns the user.

This:

> Do not include internal notes here. Provider context is deliberately
> limited to requester-visible conversation.
> This compatibility path stays until every producer emits the v2 envelope.

Do not add informal comments to every file, and do not rewrite unrelated
comments to manufacture activity. A comment that is already accurate and
natural should be left alone.

## Markdown and architecture documentation

First-person reasoning is welcome where it adds ownership. Useful section
headings: _Why I chose this approach_, _What I considered_, _Why I did
not choose the simpler option_, _Tradeoffs_, _What is intentionally not
implemented yet_, _What I would revisit before production_, _What I
learned while implementing this_, _Current limitations_.

Good:

> I kept AI suggestions advisory because provider confidence is not a
> reliable authorization signal.

> I initially considered putting ticket text directly into RabbitMQ
> events. I rejected that for this sprint because it would duplicate
> sensitive content and create another retention boundary.

Avoid inflated language, excessive headings and lists, academic filler,
marketing language inside technical docs, "enterprise-grade" without a
concrete property behind it, "best practices" without naming which and
why, and repeated claims that the architecture is robust, scalable,
modern or production-ready.

Do not imitate a human by adding spelling errors, slang or inconsistent
formatting. Natural writing stays professional and readable.

## Documentation ownership

When a sprint changes an important decision, update the document that
owns it — the sprint report, the relevant ADR, the architecture note, the
security document, the roadmap, this handoff. Do not create another
small Markdown file that repeats what an existing one says.

Always distinguish: implemented, verified locally, API ready, deployed,
planned, intentionally deferred. **Never write that a feature is
available merely because its code exists.**

## Personal project perspective

About, Engineering, sprint retrospectives and selected decision documents
may reflect that this is a serious personal project built to learn and to
demonstrate professional software development — that the goal was not
another CRUD application, that fewer capabilities done correctly beat a
list of features that are not real, that some parts are deliberately
local or API ready until deployment is configured. Do not repeat this
context in every document, and keep operational and API documentation
objective.

## How to apply it

Progressively, inside the sprint you are working on: comments in files
you are already modifying, and the Markdown directly related to that
work. Remove clearly generated or outdated wording, preserve accurate
technical content, and do not start a repository-wide rewrite unless that
is itself an approved sprint.

End every sprint report by listing the documentation meaningfully
improved, which generated or obsolete wording was removed, and a
confirmation that no fictional experience or unsupported claim was
introduced.
