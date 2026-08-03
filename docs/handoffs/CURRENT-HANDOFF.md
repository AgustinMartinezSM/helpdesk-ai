# Current handoff

**Date:** 2026-08-03
**Sprint:** **10.3 complete — the public site says what the product is. BLOCK A
IS CLOSED; BLOCK B IS OPEN.** 10.0 (brand strategy), 10.1 (design system),
10.2 (migration) and 9.4-9.16 complete
**Repository:** `C:\Proyectos\helpdesk-ai`
**Branch:** `main`. `git log --oneline -20` is the source of truth for the
tip and for what is pushed; this file is for the things git cannot tell you.

**Block A is formally complete and is not reopened.** Everything it deferred —
email delivery, seeded role-template rows, the four projections without
reconciliation, scheduled integrity checks, projection-health alerts, keyset
pagination tests at the database, load and concurrency testing, backup and
restore, a second security review, broader browser coverage, deployment and
recovery exercises, `INTERNAL_SERVICE_TOKEN` rotation and audit, retention and
export policies, automatic routing, queues, `requesterDepartmentId`, custom
roles — stays recorded in `docs/architecture/pilot-readiness.md` and in "Work
incomplete / deliberately deferred" below. **The "Exact next action" list near
the end of this file is Block A's and is no longer the next action.** Block B's
is at the bottom of the 10.0 entry.

Read `docs/progress/SPRINT-009.13.md` and `SPRINT-009.12.md` and **ADR 0022**
first — a support team and a department are DIFFERENT CONCEPTS, and the first
draft of that ADR got it wrong before the project owner stopped it. Then
`SPRINT-009.11.md`, which
removes a property three sprints leaned on (`INTERNAL_SERVICE_TOKEN` no longer
guards any mutation). Then `docs/progress/SPRINT-009.10.md` and **ADR 0021** —
membership
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

## Sprint 9.11 in one breath

**`INTERNAL_SERVICE_TOKEN` guards no mutation anywhere in the platform.**
That is the property to know, and it reverses what SECURITY.md said through
three sprints. The six structure routes left `/internal/*` — deleted, like
9.10's — and what the credential still opens is two read-only membership
lookups: the mint-time resolution auth-service calls and the verification
tickets-service calls. A spec pins that the deleted routes answer 404 with the
credential present.

**Branches, departments and stations are a product surface**
(`organizations/branches`, plus `organizations/departments|stations/:id` for
the children, which are edited by their own id). Two keys: `branches.create`
for a branch, `branches.update` for everything else about one AND everything
inside it — departments and stations get no key, because they are contents of
a scope rather than scopes, and the matrix has no row for them.

**The tenant is no longer a path parameter anywhere.** Six routes lost
`:organizationId`; it comes from `requireOrganization(actor)`. An operator
holding the database could be trusted to name a tenant; a browser cannot.

**A station's responsible person is named by `userId`.** The column still
holds a membership id — nothing a browser can reach ever returns one — and
`ListBranchStructureUseCase` translates it back in one query. A membership
that has since vanished resolves to null rather than failing the read: SET
NULL says losing a manager must not take the place down.

**Archiving a branch does not cascade.** Its departments and stations are
untouched, so reopening restores it exactly. A cascade could not be undone —
un-archiving would have to guess which children were already archived. It is
also unnecessary: tickets-service refuses an archived branch at the branch
lookup, so nothing under it is reachable through it.

Three things NOT to do: never re-add `:organizationId` to a public route;
never make archiving cascade; never let a station become something that
authenticates (ADR 0016/0017 — it is the till, not the cashier, and the screen
says so out loud because somebody will otherwise expect a shared login).

## Sprint 9.12 in one breath

**A support team is NOT a department, and the model says so.** A department
(ADR 0016) is the requester's organizational area and belongs to exactly one
branch. A SUPPORT TEAM is the group that resolves a ticket, it is
ORGANIZATION-owned, and its branch reach is an explicit join —
`support_team_branches`, where **no rows means organization-wide**. That one
mechanism expresses central, organization-wide, regional and branch-local
teams. Do not merge the two concepts, and do not "fix" this by making
`Department.branchId` nullable: ADR 0022 rejects that explicitly, and the
first draft of that ADR made the mistake so nobody has to make it again.

**`tickets.read_team` finally has a call site**, which closed the sharpest
hole in the permission map: `service_desk_manager` and `team_manager` held
`tickets.assign_agent` with no read beyond their own tickets — they could
assign work they could not list.

**The `tm` claim is minted like `br`, with ONE asymmetry**: archived teams are
EXCLUDED, while archived branches stay in `br`. A branch is a place and its
history stays visible to whoever covered it; a team is a working group, and
archiving one is how an organization says it no longer works.

**`routing.manage` reaches every ticket in the organization.** Routing does
not check `canView` first, deliberately: triage is placing work nobody has
placed, and a desk manager holds `read_team`, so requiring visibility would
let them route only what was already theirs. The consequence — a holder can
place any ticket into their own team and thereby read it — is in ADR 0022.

**Scope is enforced at ASSIGNMENT, not at read.** A branch-local team cannot
see unauthorized branches because such a ticket was never assignable, not
because a filter removes it later. A ticket with no branch cannot go to a
scoped team at all.

**No screen.** The whole surface was api-ready; 9.13 built the screen.

Three things NOT to do: never derive `read_team` from department membership;
never treat an empty `branchIds` as "serves nothing" (it is the
organization-wide case, in the domain, the projection AND the event); never
add a team field to a ticket event payload — that is a v3 conversation.

## Sprint 9.13 in one breath

**Support teams have a product surface now**, so nothing about them is
api-ready any more: the Organization screen gained a Support teams section
beside Branches (not a fourth nav entry — teams are organization-owned setup,
which is what that screen is), the ticket detail gained a routing control, and
the ticket list gained a filter over the caller's own teams.

**`service_desk_manager` gained two keys, and only one is a matrix cell.**
`branches.read` is theirs by the matrix and finally had a call site — a team's
reach is a set of branches and the coverage editor cannot name what it may not
read. The other was a flat `people.read` widening; **Sprint 9.14 retired it
after one sprint** and gave them `people.read_assignable` instead. Read 9.14's
entry below rather than acting on this paragraph.

**`GET /organizations/teams/mine` has NO permission key**, deliberately. The
people who need to turn `assignedTeamId` into a name — team_manager, agent,
auditor — hold no team key at all, and it returns nothing their own token does
not already carry in `tm`. It reads through the SAME
`listActiveTeamIdsForMembership` the claim is minted from, so the two can never
disagree about archived teams; do not "simplify" it into a second query.

**Two defects that only building the surface could find.** `GET /tickets?assignedTeamId=`
answered **400** — the use case honoured the filter since 9.12, the DTO never
declared it, and the service runs `forbidNonWhitelisted`. And
`InvalidTeamContextError` had **no HTTP mapping**, so routing to an archived or
foreign team answered **500** where 9.12 documented a generic 422. Both were
correct and tested below the HTTP boundary. The lesson to carry: a use-case
test never crosses the exception filter, and the filter's 500 fallback is what
made the second one visible instead of a plausible 404 — **do not soften that
fallback**.

**The routing picker offers only ACTIVE teams** while the administration
listing keeps archived ones so they can be reopened. And the ticket-list filter
is fed by `/teams/mine` even for somebody who could call the administration
listing: nobody's ticket list should offer a team whose work they cannot see.

Three things NOT to do: never let the teams section grow a department control
(the two concepts share a screen and that is exactly where they would blur);
never gate `/teams/mine` on `teams.manage` — the people it exists for do not
hold it; never let the coverage editor treat an empty selection as "no change"
— the empty array is the instruction that makes a team organization-wide, and a
browser pass confirmed it round-trips to zero rows.

## Sprint 9.14 in one breath

**The vocabulary question that blocked seeded role-template rows since 9.4 is
settled, and the rows are still not built.** That is deliberate: what was
blocking was a decision, and what is left is mechanism (a migration, a
repository, an evaluator read). Nobody is waiting on an answer any more.

**The stable role keys are the snake_case values already stored**, and they now
live in `libs/security` (`role-templates.ts`) beside the permission keys, with
the same rule: keys are shared, the template→permission MAP stays in
organizations-service (ADR 0013). Four spellings existed before — lowercase
prose in ADR 0015, `SCREAMING_SNAKE` in the target-state table, `ORG_ADMIN` in
the matrix columns, snake_case in code. Nothing was renamed: those strings are
in `memberships.role_template` and `invitations.role_template`, so a rename is
a data migration bought for a cosmetic.

**Every template declares a scope, and grantability derives from it.** ADR
0015 says no organization may produce a platform super admin; that held BY
ABSENCE until now, because the grantable list was "everything except `owner`"
and nothing platform-scoped existed. A test builds a platform-scoped template
the way a future sprint would and watches the derivation refuse it. **Do not
re-derive the grantable list anywhere** — invitation, role change and the CSV
import that does not exist yet all read `ORGANIZATION_GRANTABLE_TEMPLATES`.

**`people.read_assignable` retired 9.13's widening after one sprint.** A member
picker cannot work from own scope, because it exists to add somebody who is NOT
in the team yet — so the KEY narrowed instead of the scope. It answers active
members as `{userId, name, email}` and nothing else, and the desk manager lost
the directory, `GET /users/:userId`, the People screen and everybody's role,
status and phone. Verified over HTTP: 200 on `/people/assignable`, 403 on
`/people`, same token.

**That narrowing nearly made `service_desk_manager` ungrantable by anybody.**
The ceiling compares permission sets, so a template holding a key its granter
does not literally hold is the exact failure `tickets.read_branch` caused in
9.10. `people.read` now implies `people.read_assignable` in
`IMPLIED_PERMISSIONS` — the second time that table's warning comment has been
needed. **Add a line whenever a key is narrowed or split.**

**`GET /organizations/memberships/role-templates` answers per actor** from the
stored membership, and the browser's hardcoded seven-template array is gone. An
agent used to be offered every role and refused all of them on submit.

**The ticket list's team control is a "Show" group, not a filter.** The server's
team scope is `assignedTeamId IN (…) OR requesterId = me` — a visibility union,
deliberate since 9.5 — so choosing a team keeps your own requests. 9.13's
"Filter by support team" promised a narrowing it does not perform.

Three things NOT to do: never rename a role-template key without a data
migration (they are stored values, not labels); never let `○` back into the
evaluator — it is matrix notation, and every cell is now classified (a) a
distinct key, (b) domain logic, or (c) deferred; never let a screen build its
own list of grantable roles again.

## Sprint 9.15 in one breath

**A CSV import issues INVITATIONS. It creates no accounts and sends nothing.**
ADR 0016 (no placeholder password hash) and ADR 0008 (no provider adopted)
decide that between them, so a file of two hundred people hands back two
hundred codes an administrator distributes by hand. The cost is real, the
screen says it BEFORE they start, and email delivery is what fixes it.
`people.create` is still unimplemented and an import is not it.

**Nothing is ever created from a misspelling.** A branch, department or role
that does not resolve exactly is a row failure quoting the value back — no
fuzzy matching, no creation. A department named without a branch is refused
outright (`Department.branchId` is a required FK and a name can repeat across
branches), and "no such department here" and "that department belongs to
another branch" are deliberately DIFFERENT messages.

**Roles go through the 9.14 derivation and nothing else.** The import keeps no
list of its own: `isGrantableRoleTemplate` plus `canGrantRoleTemplate` against
the importer's STORED membership is the whole answer, so `owner` is refused by
constant and a platform-scoped template by scope. **Never give the import a
list of its own.**

**An invitation can now carry a placement.** `branch_id` and `department_id`,
nullable, real foreign keys because branches live in this database, applied at
redemption INSIDE the transaction that already inserts the membership. ON
DELETE SET NULL, not CASCADE: removing a branch must not burn a code nobody can
reissue. The single-invitation form leaves both null forever.

**Every row is its own unit; there is no batch transaction.** Partial
application, no rollback, safe to re-run. Idempotency is the partial unique
index plus the invitation table's own accepted rows — not a new mechanism and
not a cross-service question. **The residual case, stated rather than hidden:**
somebody who became a member WITHOUT an invitation (the first administrator,
made in SQL) is not in that table, so an import would issue them a code.
Redeeming it is harmless — the membership insert skips duplicates and leaves
their role alone.

**The audit record is counts and the actor, never a row and never an address.**
The per-invitation events already attribute who was invited; addresses in a
batch event would copy a few hundred people into a second retention boundary to
say nothing new.

**The preview and the apply are two endpoints, and both answer 200.** If they
shared one, "check the file" would write. 201 Created on a dry run was the
first version and it is a lie told in the protocol rather than in the copy.

Three things NOT to do: never let the import create structure or a template;
never put an address or a code in the batch event; never merge the preview and
the apply.

## Sprint 9.16 in one breath

**A cold tickets-service now repairs itself.** organizations-service offers
three read-only keyset-paginated snapshots under `/internal/structure/*`
(branches, stations, teams-with-scope), behind the same guard and credential
Sprint 9.11 left holding two read-only lookups. tickets-service pulls them at
boot and on demand.

**The ordering IS the safety argument, and it lives in one place.**
`StructureEventsConsumer.onApplicationBootstrap` subscribes and THEN
reconciles. `subscribe()` resolves only after the queue is bound, so from that
moment nothing published can be discarded; the snapshot is applied through the
same last-write-wins guard the events use, so an update landing mid-walk wins
on its newer timestamp. **Never reverse those two calls** — snapshot-then-
subscribe reopens exactly the window this closes.

**Drift is reported, never repaired.** The domain archives rather than deletes,
so a local row the snapshot did not offer is a fact nothing explains. It is
counted as `orphaned` and logged; removing it stays a human decision.

**There is no `department_refs` and none was created.** The plan named one;
departments publish no contract by design (ADR 0022 — "no consumer, no
promise"). `station_refs` WAS added to scope although the plan did not name it.

**tickets-service now accepts the service credential**, so it has its own
`InternalServiceGuard` — a deliberate copy, because a shared one would have to
depend on each service's validated env type. It also gained
`INTERNAL_SERVICE_TOKEN_PREVIOUS` for rotation and `amqplib` as a dependency
(the cold-start spec deletes the durable queue so the start is genuine).

**The on-demand reconcile is a write path behind the credential**, which 9.10
and 9.11 deleted for memberships and structure. The justification is written in
the controller rather than assumed: those changed DOMAIN state with no person
attached, this converges a cache toward its owner and expresses no decision.

**The operator procedure is `docs/architecture/projection-reconciliation.md`.**
Bootstrap, dry-run integrity check, repair, the seven counters and what a
healthy projection answers (`inserted` and `updated` both zero), a
symptom-to-cause table for every failure the code can produce, and safe
recovery. The two things a hurried reader gets wrong: **re-running from the
beginning IS the recovery mechanism** (the resume cursors are a convenience, and
a resumed run deliberately reports no orphans because it never saw the earlier
pages), and **deleting projection rows to force a rebuild helps nothing** — it
makes every located ticket unfileable until the walk finishes and corrects
nothing the walk would not have corrected in place.

**The rules now live in the ADRs rather than only in the sprint record**: 0003
(rebuild without crossing a database — the snapshot is read-only, keyset
paginated by id, and the row carries its own tenant), 0005 (a durable queue does
not exist before its consumer's first boot; subscribe-then-reconcile plus
last-write-wins on source timestamps is the whole argument), 0013 (other
services hold a cache of the organizational graph; repair is one-way), 0022
(departments publish nothing, so there is nothing to project — "no consumer, no
promise").

**`INTERNAL_SERVICE_TOKEN` guards a mutation again, and the wording elsewhere
had to change.** From 9.11 until this sprint it guarded none; the on-demand
reconcile writes. It writes projection rows only — no domain entity, no
deletion, nothing a person decided — which is why it is justified rather than a
reversal, but the old one-line summary is now false and pilot-readiness item 3
says so.

Three things NOT to do: never reverse subscribe-then-reconcile; never make
reconciliation delete a row; never let the snapshot endpoints become a general
cross-service data layer — they are three specific reads for four specific
projections.

## Sprint 10.0 in one breath — the first Block B sprint

**Nothing shipped and nothing changed in the product. That is the sprint.** It
is strategy and product definition, and its whole output is
`docs/architecture/brand-strategy.md` plus three factual corrections. Read the
strategy before touching any surface in Block B; it is authoritative for **how
things are said**, and `apps/web/src/lib/product-status.ts` stays authoritative
for **what is true** (ADR 0009). That split is the one rule to carry.

**The audit's finding was the opposite of what anyone expected: the site does
not overstate, it understates.** `product-status.ts` was last touched in the
9.12 documentation commit, so the public site tells visitors the support-teams
screen "is planned" while an administrator has been using it since 9.13, and
CSV import, org-defined profile fields, shared-terminal sessions and projection
reconciliation appear nowhere at all. Ten truth defects are listed with
evidence at the end of the strategy document. **They are 10.1's first task, not
10.0's** — every one changes a rendered page or a public claim, and this sprint
wrote no UI.

**Three brand decisions were made, and one of them is the material one.** The
visual thesis is **ink acts, yellow marks, chroma states**: the action colour
becomes achromatic (near-black on warm paper, inverted in dark), `#FFEE8C`
becomes the signature that marks where you are, and blue/amber/green/red stay
reserved for status and priority. **Indigo leaves.** The argument is structural
rather than aesthetic — the status palette already spends every chromatic slot,
so an achromatic action colour is the one that collides with nothing — but it
is a conclusion drawn from a constraint, not the only one available, and the
document says so. **It is cheap to redirect at 10.1's Definition of Ready and
expensive after the token layer ships.** The other two: Helpi keeps its
behaviour exactly and changes its language to es-AR with voseo, and
"From signal to resolution" is adopted with a Spanish interpretation rather
than a translation — _"De un aviso suelto a un problema resuelto."_

**Every ratio in that document was computed in this sprint, not copied.** The
existing figures were re-verified and are correct (indigo 6.02:1 / 6.67:1,
yellow 1.13:1 as text, 15.07:1 with `--brand-on`). Two of my own first-pass
candidates **failed** WCAG 1.4.11 at 2.35:1 and were replaced before anything
was written down. The focus ring now inverts with its surface, which turns the
dark CTA panel's hand-rebinding into the rule instead of an exception, and the
section bands must be re-tuned because warming the base neutral costs the
tinted band its separation (1.1 L\*, below the 1.7 the design system already
found imperceptible).

**The request/ticket split is now a rule, not the accident it was.** A
requester opens a **request**; staff work a **ticket**; same row. Spanish:
**pedido** and **ticket**. And the vocabulary table binds in both languages —
a department is an **área** (where a requester works, one branch), a support
team is an **equipo de soporte** (who resolves, organization-owned). Role
LABELS get Spanish; **role KEYS are stored values and are never translated and
never renamed** (9.14).

**Bilingual scope is deliberately unanswered.** There is no i18n anywhere
today — `lang="en"` is hard-coded, every string is a literal, and `ROLE_LABELS`
is the only translation-ready seam in the codebase. Whether Spanish is Helpi's
voice only, the product's second language, or its first is the one decision
with a large cost and nothing in the repository to settle it. **10.1's
Definition of Ready must answer it before any i18n work starts.**

Three things NOT to do: never let the brand document decide what may be
claimed — it decides phrasing, and `product-status.ts` decides truth; never
give the brand yellow a job that carries text or information (1.12:1 on the
proposed paper, and the measurement is why the rule exists rather than a
preference); never let Helpi become an assistant, a copilot or a chatbot in
either language — the spec blacklist is English-bound today and needs Spanish
equivalents in the same commit as the copy, or the suite will pass while
asserting nothing.

**The next action is Sprint 10.1 — the design system.** In this order: refresh
`product-status.ts` first (every other claim depends on it), then the token
layer with every ratio re-measured rather than trusted, then the mark and the
wordmark (and delete `apps/web/public/favicon.ico`, which is Nx-scaffold
artwork unrelated to the indigo mark it competes with), then underlined inline
links, then the five-slot tagline architecture replacing today's four
competing lines. Open it with its own Definition of Ready, and settle the
bilingual scope there.

## Sprint 10.1 in one breath — the strategy, implemented

Remote CI green on the closing HEAD: run `30840468940` on `309d498`, first
attempt, one run covering all nine commits. The full local gate ran green too:
format, lint, typecheck, **249 unit tests across 27 suites** and build.

**The reference is `docs/architecture/design-system.md`.** Read it before
touching a colour. `frontend-design-system.md` keeps the component inventory
and Helpi's behavioural contract; its colour half is superseded and says so.

**Ink acts, yellow marks, chroma states — and indigo is gone from the
repository, not just from the pages.** The action colour is achromatic
(`#1a1a17` light / `#f5f3ed` dark) on warm paper neutrals, `#ffee8c` is the
signature, and blue/amber/green/red stay reserved for status. Two tests hold
the families apart by construction: `--action` must be achromatic and every
semantic colour must not be. **`--accent*` still exists as a documented alias
of the `--action` family and Sprint 10.2 deletes it** — 73 call sites used it,
aliasing migrated all of them at once, and only the ones whose MEANING changed
were moved by hand.

**`product-status.ts` is current again, and that was the first commit.** It
was four sprints stale. Support teams moved to `available`; five capabilities
that had no entry at all were added, two of which are the brand's first proof
points; `PROJECT_STATUS` stopped claiming the product ended at Sprint 9.0. The
seven hard-coded statuses are gone — **seven, not the six the defect list
named**; the extra one is `hero-visual.tsx` and a spec pinned it.

**ADR 0009 gained two amendments and the first is the lesson worth carrying.**
Its rule that no page hard-codes a status was written the day the ADR was, and
seven pages did it anyway, because the rule lived in a decision record. **A
rule about what code must not do belongs in a test** — `claim-truth.spec.tsx`
now. The second settles that `available` means somebody can rely on the
capability without building anything first, not that a screen exists.

**Three defects were found by the browser and could not have been found by the
unit suite**, which is the part to remember. One indigo survived because the
CTA panel rebound the token by hand — found by counting elements whose
COMPUTED colour was indigo. The hero's yellow emphasis measured 1.06:1 in the
dark theme, invisible exactly where the emphasis was, because the heading is
near-white there while the brand is one value in both themes. And the section
bands had a join I had not counted: the landing puts a `default`-tone section
between sunken and raised, and `default` IS the page background. **The band
test now derives its pairs from the tone sequence rather than from my memory
of it**, and the two joins that genuinely cannot be separated by lightness
(`base↔raised` in light, `base↔sunken` in dark) are named exemptions with a
second test asserting they are still that close.

**The mark is a dot, a track and an end stop.** It is the product's own
smallest unit — every ticket in the interface is a priority dot followed by a
row. One asset for both themes, verified legible from 16px. `favicon.ico` was
DELETED, not restyled: it was Nx scaffold artwork competing with the real
icon. The wordmark stopped colouring "AI".

**Helpi speaks es-AR with voseo and is the ONLY translated part of the
product.** That is deliberate: es-AR is the primary language, full i18n is
**Sprint 10.8**, and half-translating ahead of the machinery that keeps two
languages in step is how a half-translated interface happens. Its silhouette
is now a rounded square with the mark's corner ratio, because a floating
circle in a corner is the universal sign for the one thing Helpi is not. Four
rules became tests: compass-not-sparkle (doc-only before), the
planned-capability guard now covers every route rather than public ones only,
`/organization` has a hint instead of falling through to the public marketing
intro, and the chatbot blacklist speaks both languages.

Three things NOT to do: never paint a `--brand` background without setting a
colour in the same rule (inheriting is the bug — what it inherits differs
between themes while the brand does not); never add a section tone without
re-measuring the sequence the page renders, because the pairs are not the ones
the token file suggests; never let Helpi grow a loading state — nothing it
says is fetched, so a spinner would imply a capability that does not exist.

**The next action is Sprint 10.2.** Its first task is finishing the migration:
move the remaining `--accent*` call sites to the semantic names and delete the
aliases. Then the visual debt `design-system.md` lists — no social preview
image, no `not-found.tsx` or `error.tsx`, the Account screen printing raw role
keys — and the public-site copy work the brand strategy scoped. Open it with
its own Definition of Ready.

## Sprint 10.2 in one breath

Remote CI green on the closing HEAD: run `30846715801` on `bc593e6`, first
attempt. The full local gate ran green too — and for the first time it says
**15 projects** rather than 14, because `@helpdesk-ai/web` finally has a
typecheck target. 260 unit tests across 28 suites.

**`--accent*` is gone.** The two-step is the part to reuse: 10.1 aliased the
old names so nothing broke, 10.2 moved the 44 remaining call sites to the
token that owns each JOB and deleted the aliases. **The same `--accent` was
doing four different things** — an action, a focus ring, an identity chip,
and a colour twelve elements had only because a colour was there. A
find-and-replace would have made all four the same thing permanently. One
token was added: `--focus-halo`, for the soft inner glow a form control draws
where its own border radius would clip an offset ring.

**`var(--typo)` is not an error in CSS**, and that is the finding worth
carrying. It falls back to the inherited or initial value and the page
renders, so a mistyped token is invisible until somebody looks at the pixel.
A test now resolves every custom property every stylesheet asks for, and it
found **five undefined tokens in shipped code** — the worst a `--surface-1`
with no fallback that had been leaving the invitation-code block with **no
background at all**. None was introduced by the migration; all were older
than it.

**`not-found.tsx` and `error.tsx` exist, at the ROOT.** A URL matching no
route matches no route group either, so one under `(public)` would never
render for the addresses that need it most. They carry the mark rather than a
shell, because `AppShell` needs a session and a mistyped URL must not depend
on the BFF being up. The error screen **never puts `error.message` on the
screen** — Next redacts it in production and leaves it real in development,
and a screen that shows a stack trace in one environment and not the other
teaches people to distrust it. It shows the `digest` instead and logs the
real error to the console.

**There is a social preview image**, generated rather than drawn: a binary
would be a second source of truth for the identity and would go stale
silently. Same geometry as the mark, so a reviewer can diff it.

**`apps/web/specs` is type-checked, and the reason it never was is worth
knowing.** Three compounding faults: `tsconfig.spec.json` listed
`src/**/*.spec.tsx`, which matches nothing because the tests live in
`apps/web/specs`; it referenced `tsconfig.json`, which sets `noEmit`, so
`tsc -p` failed with **TS6310 before reading a file** — anyone who tried
would have concluded the setup was broken, and it was; and
`@helpdesk-ai/web` had **no typecheck target at all**, which is why the gate
printed "14 projects" for months in a 15-project workspace. It now says 15.
The specs were type-clean; I verified the check is not vacuous by breaking it
on purpose and watching it fail.

Three things NOT to do: never delete `apps/web/.next` while the dev server is
running (it corrupts the server's state and produces an Internal Server Error
that looks like a defect in whatever you just wrote — it cost this sprint a
wrong diagnosis); never add a token reference without checking it resolves,
because CSS will not tell you; never let an error screen guess at a cause —
every domain refusal renders inside the page that raised it (ADR 0020), so
reaching that screen means the product does not know.

**The next action is Sprint 10.3.** The remaining visual debt is small and
listed in `design-system.md`: no checkbox/radio/Dialog/Banner/Tooltip
primitives (and none should be invented ahead of a use case), and the
authenticated surface still unopened in a browser. The larger Block B work is
the public-site copy the brand strategy scoped — the multi-tenant story is
the product's actual shape and is nearly absent from public prose. Open it
with its own Definition of Ready.

## Sprint 10.3 in one breath

Remote CI green on the closing HEAD: run `30855665981` on `19760f2`, first
attempt. Full local gate green too: 266 unit tests across 28 suites, and
typecheck across 15 projects.

**A visitor can now learn from the site that the product is multi-tenant.**
Before this sprint "department" and "service point" appeared in NO public
prose and "branch" only in a technical listing — so the thing the brand calls
its first differentiator was invisible. `/how-it-works` now defines the five
structural terms, and the landing has a section saying what the structure
BUYS rather than what it is.

**The public site and the product now say the same sentence about the thing
most likely to be modelled wrong**: "A department says where somebody works; a
support team says what they fix." A test asserts the page teaches it and that
no copy anywhere says a support team belongs to a branch.

**The band test now DERIVES the tone sequence from the page source.** This is
the part worth carrying. 10.1 hard-coded the sequence it believed the landing
had and passed while the page carried a join it had not counted; 10.3 added a
section, which would have made that list stale a second time in two sprints.
It reads `<Section>` tones out of the page files, treats a missing `tone`
prop as `default` — the exact thing 10.1 forgot — and covers
`/how-it-works` and `/features` too. It immediately caught the new section
sitting 2.1 L* from its neighbour.

**Two stragglers from 10.1 were still in the footer**: the fourth competing
tagline, and "Demo environment — no production data", which claimed a
deployment that does not exist two pages after the hero says nothing is
hosted.

**`aria-hidden` hides something from assistive technology, not from eyes.**
The hero's decorative panel had labels at 4.00:1 and had never been
questioned because the scene is hidden. They are `--text-secondary` now.

Three things NOT to do: never hard-code a page's tone sequence beside the
test that checks it — derive it, or it goes stale the next time somebody adds
a section; never assume a `<Section>` without a `tone` prop is not a band
(it is the page background, and it is adjacent to whatever follows); never
insert a declaration into a CSS rule without checking what is already there —
mine landed above an existing `color` and lost silently, and the browser was
right while my reading of the file was wrong.

**The next action is Sprint 10.4.** What remains of the design-system debt is
small and listed in `design-system.md`: no checkbox/radio/Dialog/Banner/
Tooltip primitives — and none should be invented ahead of a use case — and
the authenticated surface still unopened in a browser (six dev servers
against five preview slots). The larger Block B work left is organizational
onboarding, where the brand's promise meets the fact that the first
administrator of a new database is still made by hand. Open it with its own
Definition of Ready.

## Things that will bite you if you do not know them

- **Resolution fails closed on uncertainty only**: cannot-ask → 503,
  belongs-nowhere → token without tenant claims, refused at writes with 403.
- **`INTERNAL_SERVICE_TOKEN` lives in three `.env` files** (auth, tickets,
  organizations). From 9.11 until 9.16 it guarded NO MUTATION anywhere; that
  sentence is now false and is worth unlearning deliberately, because three
  sprints leaned on it. What it opens today: the two read-only membership
  lookups, 9.16's three read-only structure snapshots, and 9.16's on-demand
  reconcile, which WRITES — projection rows only, nothing a person decided, no
  deletion. Since 9.8 it is ROTATABLE
  (`INTERNAL_SERVICE_TOKEN_PREVIOUS`, accepted alongside the current value;
  runbook in SECURITY.md) and the gateway strips its header inbound. What is
  still missing is ATTRIBUTION: nothing records which process called, and
  closing that needs per-caller secrets or a signed service assertion — a
  self-declared caller header would log a claim the credential does not bind.
  tickets-service without the credential refuses every assignment with 503, by
  design — and since 9.16 it also boots with a warning that reconciliation is
  not configured, after which a cold projection fills only from new events. If
  a fresh environment refuses every located ticket, read that warning first.
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
- **A browser pass needs six dev servers and the preview tool allows five.**
  web, web-bff, api-gateway, auth, users and organizations are all required
  for an authenticated screen, so 9.10 signed in first and then traded
  auth-service for users-service — which works because a soft navigation does
  not re-mount AuthProvider and so does not refresh the session. 9.13 used the
  same trick and hit the ceiling again: tickets-service would have been the
  SEVENTH, so the ticket listing and the routing control answered 504 in that
  walk and were never seen in a browser. The `.claude/launch.json` entries that
  define them are **git-ignored**, so they are on that machine only and have to
  be written again elsewhere; only `web` was ever in a fresh checkout.
- **A jest suite that PASSES and then hangs is a teardown bug, not a slow
  test.** Sprint 9.16's integration run was killed at eight minutes with no
  output; run alone with `--detectOpenHandles` the same spec finished in under
  four seconds. The cause was a helper creating a `MessagingClient` per test
  while `afterAll` closed only the last one, leaving AMQP connections jest then
  waited on forever. Track every client, publisher, consumer and Prisma
  instance a spec creates and close all of them. Diagnose with the single spec
  and `--detectOpenHandles` before suspecting the broker or the database.
- **A literal byte-order mark in source is a lint error.** The CSV parser has
  to strip one — Excel writes it, and left in place the first header parses as
  U+FEFF + "email" so the file is refused for a column nobody can see — but
  `no-irregular-whitespace` refuses the character itself. Write the escape.
  Same in the spec that tests for it: an invisible character in a test is how
  that test gets silently deleted later.
- **A stuck login form is usually a stuck `submitting` flag.** `handleSubmit`
  returns early while `submitting` is true, and a first attempt that raced a
  starting auth-service leaves it stuck with no error rendered — the button
  looks dead and nothing reaches the network. Reload the page. Also on this
  run, the preview tool's `form_input` set input values without React
  registering them, so credentials had to be typed with real keystrokes; when a
  form submits nothing, check the React state before suspecting the handler.
- **`next dev` 404s on every route if `.next` holds a production build.**
  Running the full gate (which ends in `next build`) and then starting the dev
  server gives a Turbopack server that answers 404 for `/`, `/register`,
  everything. `rm -rf apps/web/.next` and restart. Cost 9.13 ten minutes.
- **`apps/web/next-env.d.ts` flip-flops between `dev` and `build`.** Next
  rewrites the import path in it depending on which one ran last, and the file
  says not to edit it. The committed version is the BUILD variant, which is
  what CI produces; if a dev run dirties it, `git checkout --` the file rather
  than committing the churn.
- **The first administrator of a fresh database has to be made in SQL.**
  Registration lands everyone on `requester`, and 9.10 deleted the operator
  endpoint that used to promote them. That is the intended consequence of
  removing an unattributable write path, not an oversight — but it is a real
  bootstrap step, and it belongs in whatever sprint builds organization setup.

## Work incomplete / deliberately deferred

- **Seeded role-template rows** — the code map is still the interim, but the
  reason changed in 9.14. The vocabulary decision that blocked them is made;
  what remains is a migration, a repository and an evaluator read. Whoever
  picks it up is doing engineering, not adjudication.
- **Reconciliation for the other four projections.** 9.16 closed the one with
  a product consequence (tickets-service's structure refs). `directory_memberships`,
  `ticket_snapshots`, `user_snapshots` and `ticket_refs` have the same
  cold-start exposure and no equivalent path — their documented rebuilds are
  HTTP refetches with known gaps. Milder consequences, same shape of problem.
  Two residuals came with the fix: nothing SCHEDULES the integrity check (there
  is no scheduler anywhere in this repo), and drift produces a log line rather
  than an alert.
- **R9 beyond organizations-service**: 9.8 built a scoped two-organization
  fixture for that service only (its invitations table cascades, so teardown
  order became load-bearing). The other eight suites still teardown with
  unfiltered `deleteMany()`; the shared module is still owed, and 9.16's
  cold-start spec added one more file to that pile.
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
  half of ADR 0011's story 9.8 did not close. Much narrower since 9.11:
  everything behind that credential is a read, so an unattributed call can no
  longer change anything.
- **The organization's own name and slug cannot be changed from inside the
  product.** The slug is what the bootstrap lookup keys on, so immutability
  there is its own decision; the name is a small endpoint nobody has needed.
- **Departments store rows and nothing keys on them.** Routing (9.12) is what
  will, and it is also what introduces their first event — there is no
  department contract on purpose (no consumer, no promise).
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
Sprint 9.12: organizations support_teams (three tables), tickets
support_team_routing (assigned_team_id + two ref tables) — both additive and
nullable, no backfill, applied to dev and _test.
Sprint 9.6: users add_profile_fields. Sprint 9.7: none. Sprint 9.8:
organizations invitations (one table, a partial unique index in raw SQL —
do NOT "simplify" the Prisma model to @@unique, it would generate a total
index and make re-invitation impossible). Sprint 9.15: organizations
invitation_placement (`branch_id` + `department_id` on invitations, additive,
nullable, real foreign keys with ON DELETE SET NULL — applied to dev and
`_test`). Sprints 9.9, 9.10, 9.11, 9.13, 9.14, **10.0, 10.1, 10.2 and 10.3**: none.

## Tests executed (through 2026-08-03, local)

Every sprint closed with the full gate (format, lint, typecheck, test,
build) plus all nine integration suites against real PostgreSQL and
RabbitMQ, and a green remote CI run recorded in its sprint document: the
tenancy migration twice (phases 5-6, then 7-8), 9.5, 9.6, 9.7, 9.8, 9.9 and
9.10 — the last of those is run `30780847286` on `5d1534b`, green on its first
attempt, and 9.11 is run `30783298165` on `5cc0036`, green on its first and the
second of two for that sprint, 9.12 is run `30785560179` on `f6a2600`, green on
its first attempt, 9.13 is run `30788005358` on `ec065aa`, green on its first
attempt, 9.14 is run `30791213751` on `3aa7070`, green on its first attempt,
9.15's run is recorded in `SPRINT-009.15.md`, and **9.16 is run `30798798526`
on `612bea2`, green on its first attempt** — one run covering all five of that
sprint's commits, which were pushed together — **plus run `30799187949` on
`8b28263`, the closing record, green as well**. Its closing pass also ran the
nine suites locally: 75 integration tests (messaging 6, auth 6, tickets 19,
users 3, audit 5, notification 2, analytics 4, ai 7, organizations 23) plus 325
unit tests.
The backfill sequence ran once, verified clean, and is recorded in
tenancy-phase-7-readiness.md.

**Sprint 10.0 changed no code**, so its gate is documentation-shaped: Prettier
over every touched file, and the full local gate plus remote CI on the closing
HEAD to prove the repository is unchanged in every way that runs — run
`30834970537` on `a46f545` and run `30835400484` on `ba786c3`, both green on
their first attempt, and the local gate as 26 of 26 Nx cache hits. Its real
verification was different in kind — every contrast ratio and L\* value in the
brand document was computed in the sprint rather than carried over, two
first-pass candidates failed WCAG 1.4.11 and were replaced before being written
down, and the existing documented figures (6.02:1, 6.67:1, 1.13:1, 15.07:1)
were re-derived and confirmed. Its claims were then verified against the
repository by an adversarial pass whose findings are recorded in
`SPRINT-010.0.md`.

9.10 also ran a manual end-to-end walk across six real processes (browser
client → web-bff → api-gateway → auth / users / organizations) covering the
whole administration surface and every refusal, plus a browser pass over the
People screen. 9.13 ran the same six-process walk over the Support teams
section AS A `service_desk_manager` — the template its two new grants exist for
— and confirmed the empty-scope round trip in the database rather than trusting
the interface. Neither walk is automated; both are recorded in their sprint
documents with what they showed AND what they could not reach.

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

**The next action is Sprint 10.4**, as described in the Sprint 10.3 entry
above. The list below is **Block A's** candidate list, kept because it is still
the right list for whenever Block A resumes. Nothing on it is the next thing to
do, and email in particular still requires the project owner's approval under
ADR 0008.

9.15 took bulk import and 9.16 took projection reconciliation, which were the
top two of this list:

1. **Email delivery.** It moves to the top by consequence rather than by
   preference: an import of two hundred people now produces two hundred codes
   an administrator distributes by hand, which is the point at which the
   out-of-band model stops being a small awkwardness. **Still the project
   owner's decision** — ADR 0008 requires explicit approval and a superseding
   ADR naming which provider and why. Nothing should be built here without it.
2. **Seeded role-template rows.** Mechanism, not a decision, since 9.14. Turns
   the code map into rows and is what custom roles would later reuse.
3. **Reconciliation for the remaining four projections.** 9.16 closed the one
   that refused tickets; `directory_memberships`, `ticket_snapshots`,
   `user_snapshots` and `ticket_refs` still start empty and stay that way. The
   mechanism is decided now, so this is repetition rather than design — which
   also means it competes with product work on cost alone. Weigh it against
   the two residuals 9.16 left: nothing schedules the check, and drift is a log
   line rather than an alert.
4. **Transfer of ownership**, plus the organization's own name: the two small
   gaps that keep a fresh organization from being fully self-serve.
5. **Automatic routing rules**, now that manual routing is real and visible.
   Named out of 9.12 and 9.13 on the grounds that rules whose effects nobody
   can see are unfalsifiable — that objection is now answered, because a person
   can see where a ticket sits and move it.

**The short debt now lives in one place: `docs/architecture/pilot-readiness.md`**
(written in 9.15's closing pass, amended in 9.16's). It consolidates what used
to be scattered across this file, several sprint records and a comment or two —
R9 beyond organizations-service, per-caller service credentials, `mv` compared by
nobody, `apps/web/specs` outside type-checking, `refreshRequest` without a
timeout, no rate limiting, and the projection cold-start — each with the
evidence for it and what closing it would take. Item 1 is now **partly
resolved** and says so in those words: the defect that refused tickets is fixed
and its proof cited, the four projections with the same exposure are still open.
**It also says where the assessment stopped**: no load or concurrency testing,
no second pair of eyes on security, no backup story, no metrics or alerts, and
Chromium only. Read that section before treating the document as a clean bill of
health.

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

> Continue HelpDesk AI. **Block A is formally closed and Block B is open;
> Sprints 10.0 (brand strategy) and 10.1 (design system, logo and Helpi) are
> complete, and the next action is Sprint 10.2.** Read
> `docs/architecture/design-system.md` before touching a colour and
> `brand-strategy.md` before touching copy; `apps/web/src/lib/product-status.ts`
> stays authoritative for what may be claimed (ADR 0009) and is current again
> as of 10.1. Do not start email, WhatsApp, billing, SSO, SCIM or
> production-readiness work, and do not reopen Block A.
>
> Complete and green on main: the tenancy migration
> (phases 0-8), Sprint 9.5 (branches/departments/stations with branch-scoped
> visibility), 9.6 (profiles and org-defined fields, ADR 0018), 9.7
> (shared-terminal sessions), 9.8 (invitations, and organizations-service
> gaining its public face — ADR 0019), 9.9 (the people-management surface, and
> a browser that decides what to render from permissions rather than role names
> — ADR 0020), 9.10 (member administration — ADR 0021), 9.11 (organization
> setup, after which INTERNAL_SERVICE_TOKEN guards no mutation anywhere),
> 9.12 (support teams and ticket routing — ADR 0022), 9.13 (that surface in
> the product: the Support teams section, manual routing on a ticket, and the
> team scope control on the ticket list) and 9.14 (the role-template and
> permission-scope vocabulary, which closed the question that had blocked
> ADR 0015's seeded rows since 9.4), 9.15 (bulk CSV onboarding, and the
> "Validación integral" hardening pass that closes it) and 9.16 (projection
> bootstrap and reconciliation — a cold tickets-service repairs itself from the
> service that owns the data). Read
> docs/handoffs/CURRENT-HANDOFF.md, docs/progress/SPRINT-009.16.md,
> SPRINT-009.15.md and ADR 0022 before touching anything, and verify the repo
> state with git first.
>
> **The one thing not to get wrong**: a support team and a department are
> DIFFERENT CONCEPTS. A department is the requester's organizational area and
> belongs to exactly one branch; a support team is the group that resolves a
> ticket, is organization-owned, and reaches branches through an explicit join
> where NO ROWS MEANS ORGANIZATION-WIDE. `tickets.read_team` derives from
> active support-team membership and never from a department. The first draft
> of ADR 0022 merged them, the project owner stopped it, and the ADR keeps its
> misleading filename on purpose so the correction stays visible.
>
> **The lesson 9.13 paid for, worth carrying**: a use-case test never crosses
> the HTTP boundary. Two refusals that were correct and covered below it were
> wrong above it — a supported query parameter answering 400 because the DTO
> never declared it, and a domain error answering 500 because the exception
> filter had no arm for it. Both had shipped in the sprint before. When a
> sprint adds a domain rule, add the controller-level test in the same commit.
>
> **What 9.14 makes true, and must stay true**: role-template keys are STORED
> values, so renaming one is a data migration and not a rename. Grantability is
> derived from a template's declared scope in `@helpdesk-ai/security`, which is
> what makes ADR 0015's no-platform-privilege invariant structural rather than
> a property of a list that happens to be short — every grant path reads that
> one derivation, including the CSV import when it lands. And `○` in the matrix
> is notation for readers, never something the evaluator represents.
>
> **What 9.15 makes true**: a CSV import issues invitations and never
> accounts, creates no structure from a misspelling, and reads the 9.14
> derivation for every role rather than a list of its own. An invitation can
> now carry a branch and a department, applied at redemption inside the
> transaction that inserts the membership.
>
> **What 9.16 makes true, and the ordering that must not be touched**: a cold
> tickets-service rebuilds its structure projections from organizations-service
> over HTTP, never from another service's database. `subscribe()` resolves only
> after the queue is bound and every apply is last-write-wins on the SOURCE's
> timestamp, so the rule is subscribe first, snapshot second — reversing it
> reopens the window it closes, and nothing would fail loudly if you did.
> Reconciliation reports orphans and deletes nothing. There is no
> `department_refs` and there must not be one: departments publish no contract,
> because there is no consumer and therefore no promise. And
> `INTERNAL_SERVICE_TOKEN` guards a write again — the on-demand reconcile —
> after three sprints in which it guarded none; unlearn the old sentence rather
> than half-remembering it.
>
> **What 10.0 makes true**: the brand's visual thesis is _ink acts, yellow
> marks, chroma states_ — indigo leaves, the action colour becomes achromatic,
> and `#FFEE8C` never carries text or information because it measures 1.12:1 on
> the proposed paper. Helpi keeps every behaviour and changes language to es-AR
> with voseo, and its English-bound spec regexes must be rewritten in the same
> commit as its copy or the suite will pass while asserting nothing. A requester
> opens a **request** (_pedido_), staff work a **ticket**; role LABELS may be
> translated and role KEYS never. The accent-colour direction is the one call a
> different person could reasonably make differently, and 10.1's Definition of
> Ready is where to disagree with it — after the token layer it gets expensive.
> The bilingual SCOPE is deliberately unanswered and 10.1 must settle it.
>
> **What 10.1 makes true**: indigo is gone from the repository and
> `--accent*` survives only as a documented alias that 10.2 deletes; the action
> colour is achromatic BY ARGUMENT, because the status palette already spends
> every chromatic slot, and two tests hold the families apart; `--brand` is one
> value in both themes and any rule painting it as a background must set a
> colour in the same rule; the section-band test derives its pairs from the
> tone sequence the page renders, because checking the pairs I expected passed
> while the page carried a 1.9 L* join. Helpi speaks es-AR with voseo and is
> the only translated part of the product — full i18n is 10.8.
>
> **The lesson 10.1 paid for**: three real defects were found by measuring the
> RENDERED page and none of them could have been found by the unit suite — a
> hand-rebound indigo, a yellow emphasis at 1.06:1 in the dark theme, and a
> section join nobody had counted. When a sprint changes what the browser
> computes, open the browser.
>
> Open 10.2 with its own Definition of Ready, the pattern the last thirteen
> sprints set. Block A's candidate list (email delivery top by consequence, and
> still the project owner's decision under ADR 0008) is kept in "Exact next
> action" for whenever Block A resumes — it is not the next thing to do.
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
> active-only; no public route ever takes an organization id — the tenant comes
> from the token; archiving never cascades; a station authenticates nothing
> (ADR 0016/0017); a support team is never a department and `read_team` never
> derives from department membership (ADR 0022); an empty branch set on a team
> is the ORGANIZATION-WIDE case in the domain, the projection and the event,
> never "serves nothing"; no team field goes on a ticket event payload (that is
> a v3); `GET /organizations/teams/mine` stays keyless and keeps reading the
> same method the `tm` claim is minted from; the ticket exception filter's
> fallback stays 500 (it is what finds an unmapped error); do not seed
> role-template rows (vocabulary still open); do not remove the
> retiredBindingKeys literals; do not remove the gateway's
> x-internal-service-token strip; rotation must keep deriving the born window;
> never reverse subscribe-then-reconcile; reconciliation reports orphans and
> deletes nothing; the three snapshot endpoints stay three specific reads for
> four specific projections and never become a cross-service data layer.

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
