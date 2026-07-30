# Tenancy threat model

Status: **Audit finding** (Sprint 9.1). Threats are stated against the system
as it will be _once organizations exist_ — most have no current exposure
because there is only one tenant, and that is precisely why they are easy to
miss.

"Current exposure" answers: what does this look like today, on `43d4593`?
"Stage" refers to the phases in `tenancy-migration-plan.md`.

## The one that matters most

> **Every threat below has the same root cause: `isStaff(actor)` is a global
> yes/no, and the queries beneath it have nothing to filter by.**

Fixing the role check without also scoping the queries produces a system that
looks tenanted and leaks anyway. That is why the plan sequences repository
signatures _before_ the permission model, not after.

---

## T1 — Organization A reads organization B's tickets

|                      |                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | tickets-service use case                                                                                                                                                          |
| **Current exposure** | None (one tenant). `canView = isStaff \|\| requesterId === actor.id` grants every agent every ticket, which is correct today and catastrophic with two organizations.             |
| **Expected control** | `ticket.organizationId === actor.organizationId` checked **first**, before any permission is consulted (ADR 0014). Repository methods take a required scope.                      |
| **Tests**            | Org A agent GETs an org B ticket id → 404 (not 403 — preserve the existing anti-enumeration choice). Org A agent lists → zero org B rows **asserted on `items`, not on `total`**. |
| **Stage**            | 4 (read paths), enforced at 8                                                                                                                                                     |

## T2 — The silent widening

|                      |                                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | `TicketListFilter` → Prisma `where`                                                                                                                                               |
| **Current exposure** | Structural. `list` builds its predicate from optional spreads: `...(filter.requesterId ? {...} : {})`. The single scoping mechanism **fails open**.                               |
| **Expected control** | `organizationId` is a **required** field on every list filter, not optional. A missing scope must be a type error, not an empty predicate.                                        |
| **Tests**            | A test that asserts the generated query is scoped — not just that counts look right. The existing spec asserts `total` and would stay green through a full cross-tenant widening. |
| **Stage**            | 4, and it is the single highest-value test in the whole migration                                                                                                                 |

## T3 — Audit trail exposes every tenant

|                      |                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | audit-service read path                                                                                                                                                                                                                                   |
| **Current exposure** | `isAdmin(actor)` and nothing else; the actor **never reaches the WHERE clause**. `offset` is unbounded, so the trail is pageable 100 rows at a time. Payloads contain user **emails** (`user.registered.v1`) and ticket **titles** (`ticket.created.v1`). |
| **Expected control** | `organization_id` as a first-class column on `audit_events`, populated from the envelope; the actor's organization threaded into the repository filter; `offset` capped or replaced with keyset pagination.                                               |
| **Tests**            | Org A admin lists audit events → zero org B rows. A deep `offset` cannot walk past the tenant boundary.                                                                                                                                                   |
| **Stage**            | 3 (envelope) then 5 (consumers). **Cannot be fixed before the envelope carries a tenant.**                                                                                                                                                                |

## T4 — Analytics aggregates span tenants

|                      |                                                                                                                                                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | analytics-service repository                                                                                                                                                                                            |
| **Current exposure** | Five unscoped aggregates behind one `isStaff`. `total()`, `countByStatus()`, `countByPriority()` take **zero arguments** — there is no signature to thread a predicate into. `totalUsers` is a platform-wide headcount. |
| **Expected control** | `organization_id` on both snapshot tables, populated from v2 events; every repository method takes a required organization.                                                                                             |
| **Tests**            | Org A staff summary excludes org B tickets in every one of the five numbers.                                                                                                                                            |
| **Stage**            | 3 then 5. This is the largest signature change in the migration.                                                                                                                                                        |

## T5 — Forged organization context

|                      |                                                                                                                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | api-gateway → service                                                                                                                                                                                           |
| **Current exposure** | The gateway forwards **every header untouched** — no allowlist, no strip list. `x-request-id`/`x-trace-id` are already adopted verbatim and unvalidated, establishing exactly the wrong precedent.              |
| **Expected control** | Tenancy travels **only** in the signed JWT. No service reads an organization from a header, ever (ADR 0014). If a header is ever introduced, the gateway must strip and re-inject it, which it cannot do today. |
| **Tests**            | A request with a forged `x-organization-id` and a valid token for org A returns org A data and never org B.                                                                                                     |
| **Stage**            | 2 (context), and it is a permanent rule rather than a stage                                                                                                                                                     |

## T6 — Stale claims after suspension

|                      |                                                                                                                                                                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | Token lifetime                                                                                                                                                                                                 |
| **Current exposure** | The same property exists today for roles: refresh re-reads the user, so a change lands within one access-token TTL (900s default). Nothing is worse than today; it just matters more.                          |
| **Expected control** | Bounded staleness, ceiling one TTL, **documented rather than hidden**. A `mv` (membership version) claim re-validated for high-consequence operations: `organization.manage_*`, `people.assign_roles`, export. |
| **Tests**            | Suspended membership cannot mint a new token. A refresh after suspension fails. An in-flight access token expires within the TTL.                                                                              |
| **Stage**            | 6 (memberships)                                                                                                                                                                                                |

## T7 — Refresh token survives a membership change

|                      |                                                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | auth-service `refresh_tokens`                                                                                                                                               |
| **Current exposure** | The table is keyed only by `user_id`; there is **no column for which organization a session belongs to** (`schema.prisma:41`).                                              |
| **Expected control** | Decide whether a session is per-person or per-organization (ADR 0014 leans per-person). Either way, refresh must re-resolve membership and refuse when it has been revoked. |
| **Tests**            | Refresh after suspension → 401. Refresh after removal from org A while still a member of org B → a token for B, never for A.                                                |
| **Stage**            | 6                                                                                                                                                                           |

## T8 — Guessed ticket id

|                      |                                                                                                                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | tickets-service `:id` routes                                                                                                                                                                                          |
| **Current exposure** | **None today, verified.** Every `:id` route runs `canView` before returning anything, except `PATCH /:id/assignee`, which requires staff — and staff can see everything anyway, so a guessed UUID yields nothing new. |
| **Expected control** | The organization check in `canView`, plus a scoped `findById`.                                                                                                                                                        |
| **Tests**            | Guessed cross-tenant UUID → 404 on every `:id` route including assignee.                                                                                                                                              |
| **Stage**            | 4                                                                                                                                                                                                                     |

## T9 — `AssignTicketUseCase` bypasses `canView` entirely

|                      |                                                                                                                                                                                                                                                     |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | tickets-service                                                                                                                                                                                                                                     |
| **Current exposure** | Real and present. It is the one ticket path that never calls `canView` — it checks `isStaff` and existence only. The assignee is validated as a syntactically valid UUID and nothing more: no check that the person exists, is a user, or is staff. |
| **Expected control** | `canView` (or its successor) on this path, plus a membership check that the assignee belongs to the same organization.                                                                                                                              |
| **Tests**            | Assigning to a member of another organization → rejected. Assigning to a non-existent id → rejected.                                                                                                                                                |
| **Stage**            | 4. **If the migration is done by "add an org check inside `canView`", this endpoint is silently missed** — it does not call it.                                                                                                                     |

## T10 — AI service reads another tenant's suggestions

|                      |                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Boundary**         | ai-service read path                                                                                                                                                                                                                                                                                                                       |
| **Current exposure** | `ListSuggestionsUseCase` and `GetSuggestionHistoryUseCase` check `isStaff` and then query by raw `ticketId` with **no ticket lookup at all**. A code comment names the exact condition that would break it — and multi-tenancy _is_ that condition. Blast radius is model output, not ticket text: suggestions store only a `contextHash`. |
| **Expected control** | Either consult the ticket source (as the write path already does) or scope by organization.                                                                                                                                                                                                                                                |
| **Tests**            | Org A staff listing suggestions for an org B ticket id → 404.                                                                                                                                                                                                                                                                              |
| **Stage**            | 4                                                                                                                                                                                                                                                                                                                                          |
| **Note**             | The **write** path is safe by construction and should stay that way: it forwards the caller's own token to tickets-service (ADR 0011), so it inherits whatever scoping lands there. This is the pattern to copy, not to replace.                                                                                                           |

## T11 — Notification delivered across organizations

|                      |                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | notification-service write path                                                                                                                                                                         |
| **Current exposure** | `assigneeId` is trusted verbatim off the bus with no membership check. `ticket_refs` (the routing projection) is globally keyed. Reads are already scoped to `actor.id`, which is safe by construction. |
| **Expected control** | `ticket_refs` carries the ticket's organization; the recipient rule compares tenant as well as id.                                                                                                      |
| **Tests**            | An event naming an assignee outside the ticket's organization produces no notification.                                                                                                                 |
| **Stage**            | 5                                                                                                                                                                                                       |

## T12 — User directory exposes every tenant's people

|                      |                                                                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | users-service                                                                                                                                |
| **Current exposure** | The directory listing takes **no filter at all** — `findMany({ orderBy: { displayName: 'asc' } })` returns every profile **with its email**. |
| **Expected control** | Organization-scoped listing. A role check alone cannot fix this; the query has nothing to filter by.                                         |
| **Tests**            | Org A agent lists people → only org A profiles.                                                                                              |
| **Stage**            | 4                                                                                                                                            |

## T13 — Branch manager reads unauthorized branches

|                      |                                                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| **Boundary**         | Permission evaluation                                                                          |
| **Current exposure** | Not expressible. There is no branch concept and no scoped role.                                |
| **Expected control** | `tickets.read_branch` resolved against the caller's branch membership set (ADR 0015/0016).     |
| **Tests**            | Store 12's manager reading a store 20 ticket → 404. Central agent with `read_all` → permitted. |
| **Stage**            | 7 (branches)                                                                                   |

## T14 — Organization-scoped admin escalates to platform admin

|                      |                                                                                                                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | Permission evaluator                                                                                                                                                                    |
| **Current exposure** | Not expressible — roles are a flat global array with no grant path at all.                                                                                                              |
| **Expected control** | An invariant of the evaluator, not of seed data: no organization-scoped template may grant a platform permission. This must hold for CSV import and future directory-group mapping too. |
| **Tests**            | An org admin attempting to grant `PLATFORM_SUPER_ADMIN` → rejected. A CSV row requesting it → rejected with a reported error, not silently dropped.                                     |
| **Stage**            | 6                                                                                                                                                                                       |

## T15 — Event consumed with missing or mismatched tenant

|                      |                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | RabbitMQ consumers                                                                                                                                                                                                     |
| **Current exposure** | The envelope has no tenant field, so nothing can be validated. audit-service binds `#` and stores whatever arrives, verbatim — it inherits the leakiness of every contract, including contracts that do not exist yet. |
| **Expected control** | `organizationId` required on the v2 envelope; consumers reject an envelope without one rather than defaulting. DLQ, do not guess.                                                                                      |
| **Tests**            | A v2 envelope with no organization is dead-lettered, not stored. A consumer never infers a tenant from a payload.                                                                                                      |
| **Stage**            | 3                                                                                                                                                                                                                      |

## T16 — Cache key collision

|                      |                                                                                                                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Boundary**         | Any future cache                                                                                                                          |
| **Current exposure** | **None, and pleasantly so.** Redis is configured in compose and connected to nothing; there is no in-memory cache. Zero cache keys exist. |
| **Expected control** | The first cache key written must include the organization. A convention documented before the first cache exists, not after.              |
| **Tests**            | n/a until a cache exists.                                                                                                                 |
| **Stage**            | Whenever caching is introduced — record it now so it is not discovered later.                                                             |

## T17 — Cross-tenant export

|                      |                                                                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Boundary**         | Any future export or report                                                                                                                                                                                              |
| **Current exposure** | No export feature exists. `docs/architecture/data-ownership.md` documents rebuild paths that are **global reads** ("tickets-service GET /tickets with a staff token") — those procedures become cross-tenant operations. |
| **Expected control** | Rebuild and export paths scoped per organization, and the data-ownership doc updated when they are.                                                                                                                      |
| **Tests**            | A rebuild for org A produces no org B rows.                                                                                                                                                                              |
| **Stage**            | 8, and the doc must be updated in the same change                                                                                                                                                                        |

---

## Threats deliberately out of scope for Block A

- Per-tenant encryption keys and key isolation. One symmetric `JWT_ACCESS_SECRET`
  is shared by every service; per-tenant key isolation has no representation
  and is not proposed.
- Noisy-neighbour resource isolation. Column-based tenancy shares tables and
  indexes by design (ADR 0012).
- Postgres row-level security. Proposed as a second phase in ADR 0012 — worth
  doing, not in the first migration.
