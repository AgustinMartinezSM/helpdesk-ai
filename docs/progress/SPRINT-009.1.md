# Sprint 9.1 — Product domain and tenancy audit

Status: **CLOSED (2026-07-30).** Audit complete and approved; all six ADRs
Accepted. No product code changed.

Goal: understand the real system before changing its domain. This sprint
produced no feature and no migration — it produced an evidence base, six
proposed decisions and a plan I am willing to defend before anyone writes
`ALTER TABLE`.

## What I actually did

I read the code rather than the documentation, then checked the documentation
against it. Every claim in the four architecture documents carries a file and
line reference, and each is marked as verified (I read the proof) or inferred
(I reasoned past it). Where I could not determine something, it says so.

Three findings were load-bearing enough that I re-verified them by hand rather
than trusting the sweep: that the gateway performs no authorization, that
`canView` is the entire ticket visibility model, and that the repository port
takes bare ids. All three held.

## The headline

**The platform is single-tenant, and completely so.** A grep for
`tenant|organization|organisation|orgId|workspace` across every `apps/*/src`,
`apps/*/prisma` and `libs/*/src` returns zero matches. There is no partial
scaffolding to reconcile — and equally, nothing that will fail when tenant
scoping is forgotten.

Authorization is eleven isolated booleans in use cases, over a flat array of
role strings, with no resource scope. `isStaff(actor)` answers _"may this
person do this anywhere"_. Every one of those eleven has to become _"may this
person do this here"_.

## What surprised me

**I expected authorization to be concentrated in the gateway.** It is not
there at all. `apps/api-gateway/src/main.ts` mounts seven identical
pass-through proxies and its module declares only observability, health and
env — a grep for `JwtModule|UseGuards|authorization` across its source matches
only its own spec file. The BFF is the same. Every authorization decision is
made independently inside a service. That is architecturally consistent, and
it means the tenancy change lands in seven places rather than one.

**I expected the unique-constraint surface to be the hard part.** It is the
easiest. Exactly three non-primary-key unique constraints exist in the entire
platform, and only two of them are in question — the email in auth-service and
the same email in its users-service projection. There is no ticket code, number
or slug anywhere, so there is no per-tenant sequence to design. That is the
luckiest fact in this migration.

**I did not expect to find a live leak.** Every internal note writes a history
row with `detail: 'internal'` and the staff author's id, and `historyFor` is
returned to requesters unfiltered. A requester can see that internal notes
exist, when, and who wrote them. The service's own domain file says internal
notes are _"visible to staff only, never to the requester"_, and
notification-service deliberately suppresses the same signal — so two services
disagree about whether this is a secret. It is not a tenancy bug; it is
today's bug, found while looking for tomorrow's.

**The most dangerous property is that the tests would not notice.** Adding
`organizationId` as an _optional_ filter field keeps the entire suite green
while the `WHERE` clause spans every tenant, because the filter builds from
optional spreads and no test asserts a query is scoped by anything other than
`requesterId`. The one tickets integration spec checks `total` counts, never
that a foreign row is absent from `items`. That is why phase 0 of the plan is
"write the isolation test and watch it fail" before any schema changes.

## Service ownership: a new organizations-service

I evaluated extending users-service, extending auth-service, and a new
service. The reasoning is in ADR 0013; the short version:

users-service is **a projection by its own schema header** — _"rebuilt from
events, not the source of truth for identity"_. Memberships are the opposite
of disposable: losing them locks everyone out of everything. Storing something
irreplaceable inside something rebuildable means the documented rebuild
procedure can never be run again, and the documentation would be quietly wrong
from that day forward.

auth-service was the closest call. It holds identity, and membership is
genuinely adjacent. I rejected it because it is the one service whose
compromise is total, and organization CRUD, branch management and a permission
evaluator would widen that blast radius for reasons unrelated to
authentication.

So: **organizations-service**, owning organizations, memberships, branches,
departments, stations, service desks, teams, queues and the permission model
in one database. That last part is the actual argument. ADR 0003 forbids
cross-service foreign keys, and the organizational model is a dense graph
where almost every edge is an authorization input. Split across services,
every edge becomes an unvalidatable opaque id. Kept together, the database can
answer whether a branch belongs to the organization a membership belongs to.

I want to be honest about the cost: this is the largest structural change
since Sprint 6, and it ships before anything a user can see.

## Tenant context: in the token, never in a header

The brief asked for an explicit analysis of a client-supplied
`x-organization-id`. The answer here is stronger than "risky" — it is
**unenforceable**. The gateway forwards every header untouched: no allowlist,
no strip list, no rewriting. `x-request-id` and `x-trace-id` are already
adopted verbatim and unvalidated, which is exactly the wrong precedent. A
service trusting an organization header would be reading an attacker-controlled
string, with one layer of authorization beneath it and nothing else.

So the organization travels inside the signed access token, resolved at mint
time against membership, and no service reads tenancy from a header. The
tradeoff I am accepting — bounded staleness, ceiling one access-token TTL — is
written down in ADR 0014 rather than discovered later.

## Documents produced

| Document                                      | Contents                                                                         |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `docs/architecture/tenancy-current-state.md`  | Current-state map, with evidence for every claim                                 |
| `docs/architecture/tenancy-target-state.md`   | Target map, role templates, **draft permission matrix**                          |
| `docs/architecture/tenancy-threat-model.md`   | 17 threats: boundary, current exposure, control, tests, stage                    |
| `docs/architecture/tenancy-migration-plan.md` | 15-row risk register and a 9-phase plan with rollback checkpoints                |
| ADR 0012                                      | Tenant isolation model — column-based, RLS proposed as a later phase             |
| ADR 0013                                      | Organization and membership ownership — the three options and the recommendation |
| ADR 0014                                      | Active organization context — token claims, and why a header cannot work here    |
| ADR 0015                                      | Permission model — permissions over role names                                   |
| ADR 0016                                      | Branch and operational station model                                             |
| ADR 0017                                      | Authentication identifiers versus profile attributes                             |

**All six ADRs were reviewed and Accepted on 2026-07-30**, along with the
permission matrix. Accepted means the decision is settled, not that anything
is built — none of it exists in the codebase, and the migration plan is what
builds it.

## Recommendation for Sprint 9.2

**Do:**

- Write the two-organization isolation tests first and watch them fail.
- Build the shared fixture module. There is none today, and every integration
  suite truncates its tables, so a two-tenant test currently deletes the other
  tenant's rows.
- Create organizations-service, `helpdesk_organizations`, its role and its CI
  provisioning — remembering that the role list exists in two places
  (`01-service-databases.sh` and `ci.yml`) with no shared source.
- Create one bootstrap organization and memberships for every existing user.
- Add `org`, `perms` and `mv` claims to the token; extend `Actor`. Downstream
  services receive them and ignore them.
- Pass `correlationId` in the three publishers. Independent of tenancy, cheap,
  and it makes every later investigation possible.

**Do not:**

- Add `organization_id` to any table. That is phase 4, after the contracts.
- Version the event contracts. That is phase 3.
- Touch analytics or audit. They cannot be scoped until the envelope carries a
  tenant.
- Build branches, teams, queues, invitations or the permission UI.
- Change `canView` yet.

The phase boundary matters more than the phase content: Sprint 9.2 should end
with a platform that behaves **exactly** as it does today, plus an
organization nobody references yet. If anything user-visible changes, the
sprint has done too much.

## Open questions

Resolved on review: the permission matrix is approved as drafted, and
`BRANCH_MANAGER` does **not** hold `people.suspend` — a branch manager who
needs it gets `ORGANIZATION_ADMIN`, which is a visible grant rather than a
quiet widening for every branch manager.

Still open, and none blocks Sprint 9.2:

- Whether a session is per-person or per-organization. `refresh_tokens` has no
  column for it. ADR 0014 leans per-person; it needs deciding before phase 6,
  when membership lifecycle lands.
- Whether `branch_memberships` needs a scope qualifier per row, or whether the
  role template carries the meaning (ADR 0016). Decidable at phase 7.
- Whether organization-scoped login identifiers are worth building at all, or
  whether SSO makes them unnecessary (ADR 0017). No sprint depends on it.

## Documentation improved, and what was removed

Four new architecture documents and six new ADRs. No existing document was
rewritten. Two corrections are queued rather than applied, because they belong
to the sprints that touch those files: `data-ownership.md:44` claims the init
script creates only the `auth_service` role (it creates all seven), and the
same file's rebuild-path table describes global staff reads that become
cross-tenant operations once organizations exist.

No fictional experience, customer, incident, meeting or production usage
appears in any of these documents. Every recommendation is derived from code
in this repository, and the places where I am guessing are labelled as such.
