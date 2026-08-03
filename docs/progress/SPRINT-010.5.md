# Sprint 10.5 — Transferring ownership, and naming the organization

Status: **CLOSED (2026-08-04).** Remote CI green on the final HEAD: run
[`30863440095`](https://github.com/AgustinMartinezSM/helpdesk-ai/actions/runs/30863440095)
on `dbd5837`, green on its first attempt — preceded by run
[`30863018362`](https://github.com/AgustinMartinezSM/helpdesk-ai/actions/runs/30863018362)
on `b121ee5`, which is **the run in which this sprint's integration tests
executed for the first time**, since Docker was not available locally. That run
took the organizations integration suite from 28 tests to 38, and
`transfer-ownership.int.spec.ts` passed against a real PostgreSQL database on
its first execution anywhere. The Definition of Ready below was written and
checked against the repository before any code.

## Definition of Ready

**Previous dependency complete.** Sprint 10.4 is merged and closed with remote
CI green: run `30860100314` on `9c1694f`, plus its closing record — run
`30860368424` on `64d0e00`, green on its first attempt. `main` equals
`origin/main` at `64d0e00`, working tree clean. The last sprint document is
`SPRINT-010.4.md`.

**This is the second domain sprint of Block B**, and it finishes what 10.4
started: 10.4 made an organization creatable from the product, and this one
closes the two gaps that keep a created organization from being fully
self-serve. Both are small; neither is trivial, and the reasons are below.

### The two gaps, stated exactly

`CURRENT-HANDOFF.md` lists them under "Work incomplete / deliberately
deferred", and 10.4's own record repeats them:

> **The organization's own name and slug cannot be changed from inside the
> product.** … **No transfer of ownership.** `owner` can be neither granted nor
> targeted, so an organization whose only privileged member is its owner cannot
> change that from inside.

The second one is the sharper of the two. An organization created through
10.4's route has exactly one owner, and ADR 0021 makes an `owner` membership
untouchable in both directions — it is not grantable, and its holder is not
administrable. So today the person who registered the organization is its owner
for as long as the organization exists, and no sequence of operations in the
product can change that. If they leave the company, the organization has an
owner nobody can reach.

The first is smaller but it is a claim we currently make in three places, and
it is about to stop being true.

### What the repository already decided, and what this sprint must not undo

**`owner` is excluded from every grant path by constant** (`role-templates.ts`,
ADR 0021). That exclusion is what makes ADR 0015's no-platform-privilege
invariant structural rather than accidental, and 10.4's ADR 0023 goes out of
its way to say that creating the first owner is deliberately NOT a grant path
for exactly this reason. **A transfer is not a grant path either**, and it must
not be implemented by relaxing the derivation. Same argument, one step further
along: the derivation bounds what one member may hand another out of the
grantable set; ownership is not in that set and never becomes so.

**Nobody administers their own membership** (ADR 0021), and that rule is what
keeps an organization from losing its last administrator. A transfer changes
the actor's own row — it demotes them. This does not breach the rule and the
reasoning is in the ADR this sprint writes, but it is the single thing most
likely to be waved through without argument, so it gets one.

**`owner` and `organization_admin` resolve to the same permission set**, and a
test pins that premise (`role-vocabulary.spec.ts`). It stays true after this
sprint: the transfer is authorized by a **stored row**, not by a permission
key.

### The decisions this sprint makes, with the alternative each beat

**Ownership authorizes itself from the stored membership, not from a new
permission key.** The approved matrix in `tenancy-target-state.md` has no
`organization.transfer_ownership` row, and inventing one would break the rule
`permissions.ts` states in its own header — only keys with a real server-side
call site exist. It would also have to be granted to `owner` alone, which means
splitting `owner` from `organization_admin` in the permission map and retiring a
premise three files and two tests lean on, to express something the row already
says. And the key would be the _weaker_ copy: a token's claims outlive a
demotion by `JWT_ACCESS_TTL_SECONDS` (900), so the use case has to read the
stored row regardless. So it reads the stored row and nothing else.

The browser still needs a signal to decide what to render (ADR 0020). It gets
one that is better than a permission snapshot: `GET /organizations/current`
answers `viewerIsOwner`, read fresh from the row at request time.

**Renaming reuses `organization.update`.** That key exists, the matrix grants it
to owner and admin exactly, and its only call site today is users-service's
profile-field definitions. A second call site on the organization's own display
name is what the key is named after.

**The slug does not change, and this is a decision rather than an omission.**
The slug is what the bootstrap lookup keys on, what `prisma migrate deploy`
collides with if `bootstrap` is ever taken, and what ADR 0023 derived silently
so that a collision could never be reported. Recomputing it from a new name
would either reintroduce that oracle or leave the two disagreeing. Display name
and stable key are different things, and the branch surface already models the
same split (`code` immutable, `name` editable) — this is that pattern applied
one level up.

**Exactly one owner is enforced by the database, not only by the use case.** A
partial unique index on `(organization_id) WHERE role_template = 'owner'`. The
alternative — trusting a transaction and a conditional update — would be
correct today and unfalsifiable tomorrow. The index is additive, holds over
every existing row (the bootstrap organization has no owner, and each
organization 10.4 created has exactly one), and it is what makes "two owners"
unrepresentable rather than merely unlikely. It also decides the statement
order inside the transaction: **demote before promote**, or the index refuses
mid-transaction.

### The invariants this stresses, and how each is met

| Invariant                                              | How                                                                                             |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Organization A cannot transfer to a member of B        | The target is looked up scoped by the actor's tenant; foreign and nonexistent answer alike, 404 |
| A non-owner cannot transfer                            | The actor's STORED membership must carry `owner` and be active                                  |
| An admin cannot promote themselves                     | Same check; an admin's stored row does not say `owner`                                          |
| A suspended or inactive membership cannot become owner | The target must satisfy `grantsAccess`, and the promoting UPDATE re-checks `status = 'active'`  |
| An unaccepted invitation cannot become owner           | An invitation writes no membership until redemption; `invited` fails `grantsAccess`             |
| A failed transfer leaves the original owner            | One transaction, and a rollback on either conditional update missing its row                    |
| Concurrent attempts cannot produce multiple owners     | The demote is conditional on `role_template = 'owner'`; the loser sees 0 rows and gets a 409    |
| Exactly one active owner after every success           | The partial unique index, plus the two conditional updates                                      |
| Rename authorization is enforced by the backend        | `organization.update` in the use case (ADR 0015 rule 1), covered at the HTTP boundary           |
| Rename errors reveal no other tenant                   | Nothing about a rename is unique, so there is no collision to report                            |
| The reserved bootstrap slug stays protected            | Untouched — the slug never changes, and 10.4's reservation is on the creation path              |
| Creating an organization keeps working                 | Its use case is edited only to share the name normaliser, and its suites are unchanged          |

### The precedent this follows

`PrismaInvitationRepository.redeem` is the closest existing shape and this
sprint copies it deliberately: an interactive transaction whose first statement
is a **conditional** `updateMany`, where `count === 0` means somebody else got
there first and the caller turns that into a refusal rather than a retry. That
is the same mechanism a stale concurrent transfer needs, and it is already
proved against a real database by that service's integration suite.

## What this sprint is, and is not

**In scope:** transferring ownership between two members of one organization;
changing the organization's display name; the reads those two screens need; the
audit events both produce; the refusals above at the use case AND at the HTTP
boundary; a real-PostgreSQL suite for the transaction and the uniqueness claim;
an ADR for the ownership lifecycle; and the smallest complete surface on the
existing Organization screen.

**Out of scope, and deliberately:** creating a second organization for somebody
who already belongs to one (ADR 0023 defers it to the change that adds token
exchange); organization switching; token exchange; editing a slug by hand;
deleting or suspending an organization from the product; billing ownership;
SSO; SCIM; email; automatic routing; custom roles; and the next Block B sprint.

**One instruction I did not follow, and why.** The sprint brief asks for es-AR
copy on the new surface. Sprint 10.1 decided — and `design-system.md`,
`brand-strategy.md`, `helpi-hints.ts` and the handoff all record — that **Helpi
is the only translated part of the product and full i18n is Sprint 10.8**,
precisely so that a half-translated interface does not happen. Every screen in
`apps/web` is in English today. Writing this one in Spanish would create the
exact state that decision exists to prevent, one sprint before the machinery
that would keep two languages in step. So the new UI is English like its
neighbours, and Helpi's hint for the route is es-AR like the rest of Helpi. If
the intent was to bring 10.8 forward, that is a sprint, not a paragraph in this
one.

## Definition of Done

- An owner can hand their organization to an active colleague, in one
  transaction, and afterwards exactly one owner exists — the colleague — while
  the former owner is an `organization_admin` who is still a member.
- A foreign, suspended, deactivated, invited-only or already-owning target is
  refused, and the foreign one is indistinguishable from a nonexistent one.
- A non-owner cannot transfer, including an `organization_admin`, and the
  refusal is enforced by the backend rather than by a hidden control.
- Two concurrent transfers cannot leave two owners or none; the loser gets a
  409 that tells them to re-read.
- An authorized administrator can change the display name; the slug does not
  move; a fresh read shows the new name.
- Both operations are attributable and land in the audit trail with the actor,
  the organization, and what changed.
- Nothing in ADR 0021 changes, `owner` stays ungrantable, and tests say so.
- Every refusal is covered at the HTTP boundary as well as below it — the
  lesson Sprint 9.13 paid for.
- The three surfaces that currently say the name cannot be changed are
  corrected, and `product-status.ts` moves only as far as the code actually
  moved (ADR 0009).
- Full gate green plus the organizations integration suite, focused Conventional
  Commits, `--ff-only` merge to `main`, remote CI green on the final HEAD, clean
  tree, and `CURRENT-HANDOFF.md` naming the next exact action.

## Outcome

A tenant created through Sprint 10.4's route is now fully self-serve: it can be
named, renamed, and handed to somebody else, without anybody touching a
database.

### What was built

`GET /organizations/current`, `PATCH /organizations/current` and
`POST /organizations/ownership/transfer` on organizations-service, through the
BFF's `/organization/current` and `/organization/ownership/transfer`, behind two
cards on the existing Organization screen. The decision and everything it rests
on is **ADR 0024**.

### The three things most likely to have gone wrong, and what the repository said

**Ownership cannot be decided from a token, and the reason is specific.**
`owner` and `organization_admin` resolve to the same permission set — a test has
pinned that premise since Sprint 9.14 — so no claim in a token distinguishes
them. Adding a key would have meant splitting the two templates in the
permission map to express something the `role_template` column already says,
and inventing matrix vocabulary nobody approved. It would also have been the
staler of the two answers: a token outlives a demotion by 900 seconds, so the
use case must read the row regardless. The browser gets `viewerIsOwner`, read
fresh per request. A web spec gives the owner and the administrator
**byte-identical permission arrays** so a regression that started gating on a
permission key fails there.

**The statement order inside the transaction is decided by the index.** A
partial unique index is checked per statement, not deferred to commit, so
promoting before demoting would make the transaction fail against its own index
every time. Demote first, promote second, both conditional, either failure
rolling the other back.

**A transfer is not a grant, and the distinction is not a technicality.** A
grant hands a template out of the grantable set and the count of holders goes
up; this moves one `owner` between two rows and leaves the count where it was.
Routing it through `canGrantRoleTemplate` to "reuse" the checks would have meant
widening the constant that makes ADR 0015's no-platform-privilege invariant
structural.

### Two things the tests found that reading did not

**The BFF would have answered 201 Created for an operation that creates
nothing.** `@Post()` defaults to 201 in Nest, the upstream route answers 200,
and the pass-through spec caught the mismatch. It is exactly the defect Sprint
9.15 named on the import preview — a lie told in the protocol rather than in the
copy — and the people controller had already established `@HttpCode(200)` as the
answer.

**The tenant-isolation assertion I wrote first was wrong, and being wrong was
informative.** I asserted that a foreign target and a nonexistent one produce
byte-identical 404 messages. They do not: the message echoes the id the caller
supplied, which the caller obviously already knows. The real property is that
substituting one id for the other makes the two bodies identical, and that
neither mentions the organization the foreign member actually belongs to. The
test says that now, which is a stronger claim than the one I started with.

### One thing I did not do, and why

**The new UI is in English, not es-AR.** The sprint brief asked for Spanish
copy. Sprint 10.1 decided that Helpi is the only translated part of the product
and that full i18n is Sprint 10.8, precisely so a half-translated interface does
not happen; every other screen in `apps/web` is English today. Writing this one
in Spanish would have created the exact state that decision exists to prevent,
one sprint before the machinery that keeps two languages in step. Helpi's hints
for `/organization` and `/organization/new` are es-AR like the rest of Helpi,
and one of them had to change anyway — it said the organization's name could
never be changed.

### Verification

Full gate green: format, lint, typecheck across 15 projects, **1251 unit tests
across all 15** (423 in organizations-service, up 69 from 354; 281 in
`apps/web`, up 15 from 266), and build. The workspace total is counted here
rather than one service's, because the last two sprint records each quoted a
single project's number beside the word "total" and the two do not compare.

Three levels, deliberately:

- **Unit**, with fakes that honour the new partial unique index for real — a
  fake that let a second `owner` row exist would let a use case with a missing
  check pass.
- **HTTP**, through the real guard, the real validation pipe and the real error
  filter: 403 for an administrator holding identical permissions, 403 for the
  former owner whose token still says owner, 409 for an ineligible or
  already-owning target, 404 for a foreign one, 400 for a body naming a slug or
  an organization. This level exists because of the lesson Sprint 9.13 paid for.
- **Integration**, against real PostgreSQL: both rows in one transaction, the
  rollback that leaves the organization with its original owner rather than with
  none, the index refusing a second owner while still allowing two ordinary
  memberships, two concurrent writes leaving exactly one, and a rename read back
  through a fresh query with its slug intact.

**The integration suite was not run locally and I want that stated plainly, for
the second sprint running.** Docker is not running on this machine, so
`docker compose up` fails and the suite cannot start. It runs on CI, which
provisions a throwaway database per integration target. Every other level ran
here.

**No browser pass was possible either, and that is the same limitation.** The
whole surface reads from organizations-service, which cannot boot without
PostgreSQL. Sprint 10.1 recorded that measuring the rendered page finds defects
the unit suite cannot; that check is genuinely missing here, and the component
specs assert behaviour rather than appearance.

### What this leaves open

**Ownership can only be handed to somebody who is already a member.** Inviting
them first is the mechanism, and there is nothing to build — but it means an
organization whose only member is its owner cannot hand ownership anywhere, and
the screen says so rather than showing an empty picker.

**The slug still cannot change**, by decision rather than by omission (ADR
0024). Editing it would need a redirect story and a uniqueness answer that does
not leak across tenants.

**Second-organization creation is still refused**, unchanged from ADR 0023, and
it should be revisited in the same change that adds token exchange and
organization selection — which have to answer which organization a person is
acting in, how they change it, and how a token is re-minted for the new one.

**Nothing deletes or suspends an organization.** `organization.delete` is in the
matrix for `owner` and has no call site; deleting a tenant is a data-retention
decision before it is an endpoint.

### Documentation

- **ADR 0024** — new: the decision, the five alternatives rejected, and the
  consequences.
- **`SECURITY.md`** — a new authorization bullet: privilege cannot travel
  upward, a transfer is not a grant, and the one operation that reads the stored
  row rather than the token.
- **`tenancy-target-state.md`** — `organization.read` and `organization.update`
  gained call sites; why transferring ownership adds no row to that matrix.
- **`pilot-readiness.md`** — the two open items are struck through and say what
  closed them and what remains.
- **`product-status.ts`** — two new `available` capabilities, and the stale note
  claiming the name could never change is gone.
- **`CURRENT-HANDOFF.md`** — Sprint 10.5's entry and the next exact action.

No fictional experience, customer, testimonial, incident, external approval or
commercial adoption was introduced.
