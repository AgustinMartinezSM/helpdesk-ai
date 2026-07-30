# ADR 0013 — Organization and membership ownership

- Status: **Proposed** (Sprint 9.1 audit; not approved)
- Date: 2026-07-30
- Sprint: 9.1 (Product domain and tenancy audit)

## Context

Something has to own organizations, memberships, branches, departments,
teams, queues and the permission model. This is the decision the rest of the
tenancy work hangs off, because it determines where every authorization
question gets answered.

Two existing facts do most of the constraining.

**ADR 0003 forbids cross-service foreign keys, ever.** That is not a
preference; it is an accepted decision enforced by seven separate databases
with seven separate credentials. Whichever service owns organizations, every
other service can hold only an opaque `organization_id` with no referential
integrity and no join.

**The organizational model is a dense graph, not an entity.** Organization →
branches → departments → operational stations. Organization → service desks →
teams → queues. Membership → branch memberships, department memberships, team
memberships. Almost every edge is an authorization input: "may this person
see this ticket" resolves through membership, branch scope and team scope.

Put those together and the shape of the answer appears: if the graph is split
across services, every edge inside it becomes an unvalidatable opaque id. You
cannot ask the database whether a branch belongs to the organization that a
membership belongs to. That is a bad property for the substrate that every
access decision reads.

## The options

### A. Extend users-service

**Rejected, and the reason is in the code.**
`apps/users-service/prisma/schema.prisma:5-7` says it plainly: _"This table is
a projection rebuilt from events, not the source of truth for identity."_ The
service consumes `user.registered.v1` and upserts a read model. It owns
nothing.

Making it authoritative for memberships would make one service simultaneously
a rebuildable projection and an irreplaceable source of truth, which destroys
the property that makes it safe today — that you can drop `user_profiles` and
replay. Its rebuild path (documented in `docs/architecture/data-ownership.md`)
would have to become "replay events, except the parts you must never replay".

|                 |                                                                    |
| --------------- | ------------------------------------------------------------------ |
| Domain cohesion | Poor — profile projection and org structure are unrelated concerns |
| Coupling        | Low new coupling, but it corrupts an existing clean boundary       |
| Migration cost  | Low                                                                |
| Verdict         | **Rejected on design integrity, not cost**                         |

### B. Extend auth-service

**Rejected.** Identity lives here (`users`, `refresh_tokens`), and membership
is genuinely adjacent to identity — this is the closest call of the three.

Two things decide it. First, auth-service is the one service whose compromise
is total: it holds password hashes and mints every token. Adding organization
CRUD, branch management, team management and a permission evaluator widens
that blast radius substantially, for reasons unrelated to authentication.
Second, the master prompt's own distinction applies here: authentication
identifiers and profile/organizational attributes are different concepts, and
`§14` asks explicitly that they not be conflated. Putting "which branch does
María work at" in the service that answers "is this password correct" merges
exactly those two ideas.

|                 |                                                                  |
| --------------- | ---------------------------------------------------------------- |
| Domain cohesion | Moderate — identity and membership are adjacent but not the same |
| Coupling        | Good: the token minter would already hold membership             |
| Blast radius    | **Poor** — broadens the most security-critical service           |
| Verdict         | **Rejected**                                                     |

### C. A new organizations-service

**Recommended.** It owns `helpdesk_organizations`: organizations,
memberships, branches, departments, operational stations, service desks,
teams, queues, role templates and permission mappings — one database, so
every edge in that graph is an intra-service foreign key with real
referential integrity, satisfying ADR 0003 rather than working around it.

The master prompt warns against creating a service merely because an entity
exists. That warning does not apply here, and it is worth saying why rather
than waving it off: this is not one entity. It is roughly eight interrelated
tables that together form the authorization substrate, with a lifecycle
(invite, activate, suspend, deactivate), its own permission evaluation logic,
and a consistency requirement that only a shared database can give it.

|                          |                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| Domain cohesion          | **Strong** — one bounded context: who belongs where, and may do what                             |
| Coupling                 | New synchronous dependency at token-mint time (see ADR 0014)                                     |
| Database ownership       | Clean: one new database, one new role, same pattern as the other seven                           |
| Sync dependencies        | auth-service → organizations-service when minting a token                                        |
| Event dependencies       | Publishes membership lifecycle events; consumes `user.registered.v1`                             |
| Authorization complexity | Concentrated in one place instead of spread across seven                                         |
| Migration cost           | **Highest of the three** — a new service, database, role, CI provisioning and integration target |
| Operational cost         | One more process to run locally and in CI                                                        |
| Verdict                  | **Recommended**                                                                                  |

## Decision

Introduce **organizations-service**, owning `helpdesk_organizations`.

`auth-service` keeps identity and stays narrow: it answers _who is this
person_, never _what may they do where_. `users-service` stays a projection.
Every other service holds an opaque `organization_id` with no foreign key,
exactly as ADR 0003 requires.

## Why I did not choose the cheaper option

Extending users-service is the cheapest path by a wide margin, and for a
while I thought the cost argument should win — a portfolio project does not
need eight services to make a point. What changed my mind is that the cheap
option does not just add tables to a service, it removes a property. Right
now every projection in this platform is disposable: `user_profiles`,
`ticket_refs`, `ticket_snapshots` can all be dropped and rebuilt from the
event log, and `docs/architecture/data-ownership.md` documents the rebuild
path for each. Memberships are the opposite of disposable — losing them
locks every user out of every organization. Storing something irreplaceable
inside something rebuildable means the rebuild procedure can never be run
again, and the documentation would be quietly wrong from that day forward.

The honest cost of the recommendation: this is the largest structural change
since Sprint 6, and it lands before any user-visible feature does. Sprint 9.2
gets a new service and a bootstrap organization and nothing a person can see.

## Consequences

Positive:

- Referential integrity for the whole organizational graph, which is what
  authorization reads.
- One place to evaluate permissions instead of a predicate duplicated across
  services — a problem that already exists in miniature (`isStaff` is
  currently defined four times).
- auth-service's blast radius does not grow.

Negative / accepted:

- A new synchronous dependency during login and refresh. If
  organizations-service is down, tokens cannot be minted with membership
  claims. ADR 0014 has to answer what happens then.
- Nine services to run locally. `docs/architecture/local-development.md`
  grows again.
- Cross-service reporting ("every ticket in org X") needs the organization id
  denormalized into each service, which ADR 0012 already requires.

## Related

ADR 0003 (no cross-service foreign keys) is the binding constraint. ADR 0012
decides the isolation mechanism; ADR 0014 decides how membership reaches a
request; ADR 0015 defines the permission model this service evaluates.
