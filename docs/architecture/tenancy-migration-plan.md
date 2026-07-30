# Tenancy migration — risk register and phased plan

Status: **Approved 2026-07-30.** Phases map to sprints 9.2–9.4 in the
delivery plan; the threat ids are from `tenancy-threat-model.md`. Nothing
here is implemented — approval means the sequence is agreed, not that any
phase has run.

## The ordering constraint that drives everything

**Messaging contracts must be versioned before the event-fed services can
become tenant-aware.** audit-service, notification-service and
analytics-service learn everything they know from the bus, and the envelope
has no tenant field. Until it does, those three services have nothing to
scope by — no amount of work inside them helps.

That is why phase 3 (contracts) sits before phase 5 (consumers), and why
attempting them together produces a half-migrated bus.

## Risk register

Severity: how bad if it happens. Likelihood: how likely given the current
code. Both are my judgement, not measurements.

| #   | Risk                                                                                                                                                                                     | Evidence                                                                             |   Sev    |   Lik    | Services                       | Mitigation                                                                                                                                     | Sprint | Rollback concern                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | :------: | :------: | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | :----: | --------------------------------------------------------- |
| R1  | **Optional scope field silently widens every query.** `organizationId?` type-checks everywhere and defaults to cross-tenant.                                                             | `prisma-ticket.repository.ts:56` optional spread; audit's filter is all-optional too | **High** | **High** | tickets, audit, analytics, ai  | Scope is a **required** field. Missing scope must be a compile error. Add a test asserting the query is scoped, not just that counts match.    |  9.3   | None — caught at compile time if done right               |
| R2  | **Test suite stays green through a cross-tenant leak.** The one tickets integration spec asserts `total`, never that a foreign row is absent from `items`.                               | `prisma-ticket.repository.int.spec.ts:76`                                            | **High** | **High** | tickets                        | Write the two-organization isolation test **first**, before any column exists, and watch it fail.                                              |  9.2   | None                                                      |
| R3  | **`AssignTicketUseCase` is missed.** It never calls `canView`, so an org check added inside `canView` does not reach it.                                                                 | `use-cases/ticket-lifecycle.ts:79`                                                   | **High** | **High** | tickets                        | Enumerate use cases against the check, not the other way round. Add the assignee membership check at the same time.                            |  9.3   | None                                                      |
| R4  | **audit_events backfill is not uniformly derivable.** Tenant identity lives inside opaque jsonb, and each contract names its subject differently (`ticketId`, `userId`, `suggestionId`). | `audit-service/prisma/schema.prisma:19`; contracts.ts                                | **High** |  Medium  | audit                          | Backfill per event type with an explicit map; anything unmatched gets the bootstrap organization and is **logged**, not guessed silently.      |  9.4   | Backfill is additive; the column can be dropped           |
| R5  | **analytics has no signature to thread a tenant into.** `total()`, `countByStatus()`, `countByPriority()` take zero arguments.                                                           | `prisma-analytics.repository.ts:60`                                                  | **High** |  Medium  | analytics                      | Change all five signatures in one commit. Partial change leaves a dashboard mixing scoped and unscoped numbers — worse than either.            |  9.4   | Revert is a single commit                                 |
| R6  | **`isStaff` drifts across four definitions.** Updating `libs/security` misses tickets-service and users-service.                                                                         | `actor.ts:13`, `ticket.ts:70`, `user-profile.ts:35`, `[id]/page.tsx:81`              | **High** |  Medium  | tickets, users, web            | **Delete** `isStaff`/`isAdmin` rather than change their signature, so every duplicate becomes a compile error.                                 |  9.3   | None                                                      |
| R7  | **Stale membership claims after suspension**, ceiling one access-token TTL (900s).                                                                                                       | `env.ts:28-33`; `refresh-session.ts:44`                                              |  Medium  |   High   | auth, all                      | Accept bounded staleness; re-validate `mv` for high-consequence operations only (ADR 0014).                                                    |  9.4   | n/a                                                       |
| R8  | **Global email unique blocks nothing now but constrains forever.** Two constraints, in two databases, that must change together.                                                         | `users_email_key`, `user_profiles_email_key`                                         |  Medium  |   Low    | auth, users                    | Keep both global; express multi-org via membership (ADR 0017). Revisit only if email becomes optional.                                         |   —    | Changing later means a coordinated two-database migration |
| R9  | **Fixtures truncate.** Every integration suite calls unfiltered `deleteMany()`, so a two-tenant test deletes the other tenant's rows.                                                    | every `*.int.spec.ts`                                                                |  Medium  |   High   | all                            | Introduce a shared fixture module that creates two organizations and scopes teardown. There is no fixture module today — it has to be written. |  9.2   | None                                                      |
| R10 | **CI provisioning duplicates the init script by hand.** A new database or role must be added in two places with no shared source.                                                        | `ci.yml:77`; `01-service-databases.sh`                                               |  Medium  |  Medium  | CI                             | Adding organizations-service means editing both. Note it in the PR checklist; consider generating one from the other.                          |  9.2   | CI-only                                                   |
| R11 | **The gateway forwards every header untouched**, so any header-based tenancy is forgeable.                                                                                               | `service-proxy.ts:29`                                                                | **High** |   Low    | gateway                        | Tenancy lives only in the signed token. Never introduce a trusted tenant header without first giving the gateway a strip-and-reinject step.    |  9.2   | n/a — a rule, not a change                                |
| R12 | **CORS and the refresh cookie collide with per-tenant hosts.** Exact-match origins, no wildcard; cookie hard-coded to path `/session`.                                                   | `env.ts:34`; `session.controller.ts:144`                                             |  Medium  |   Low    | web-bff                        | Keep one host; select organization in-app rather than by subdomain. Revisit only if per-tenant hosts become a requirement.                     |   —    | Changing later invalidates live sessions                  |
| R13 | **A rebuild path becomes a cross-tenant operation.** Every documented projection rebuild is a global staff read.                                                                         | `data-ownership.md:58-65`                                                            |  Medium  |  Medium  | users, notification, analytics | Scope rebuild procedures per organization and update the doc in the same change.                                                               |  9.4   | Rebuilds are already destructive-then-replay; unchanged   |
| R14 | **No role-changed event exists**, so users-service's projected `roles` cannot be kept fresh.                                                                                             | contracts.ts — only `user.registered.v1`                                             |   Low    |  Medium  | users                          | Membership events from organizations-service supersede this. Do not add a role-changed event to auth-service.                                  |  9.4   | None                                                      |
| R15 | **`correlationId` is never set**, so an audit row cannot be traced to a request or an actor.                                                                                             | all three publishers pass two args                                                   |   Low    |   High   | all                            | Pass it. Cheap, independent of tenancy, and it makes every later investigation possible.                                                       |  9.2   | None                                                      |

## Phased plan

Each phase ends in a state that can be deployed and reverted. No phase leaves
a required column half-populated.

### Phase 0 — Prove the leak first (Sprint 9.2)

Before any schema change: write the two-organization isolation tests and
**watch them fail**. R2 says the current suite cannot detect the failure mode
this migration risks; the only way to trust the tests later is to see them red
first.

Also here, because they are independent and cheap: pass `correlationId` in the
three publishers (R15), and write the shared fixture module (R9).

**Checkpoint:** tests exist and fail. Nothing else has changed. Revert = delete
tests.

### Phase 1 — organizations-service and the bootstrap organization (9.2)

Create the service, `helpdesk_organizations`, its role, its CI provisioning
(both places — R10), and one **bootstrap organization** that every existing
row will belong to. Memberships for all existing users. No other service
changes.

**Checkpoint:** the platform runs exactly as before, with an organization
nobody references yet. Revert = drop the database, remove the service.

### Phase 2 — tenant context in the token (9.2)

`org`, `perms`, `mv` claims; `Actor` gains `organizationId` and
`permissions`; auth-service resolves membership at mint time. Downstream
services receive the claim and **ignore it**.

**Checkpoint:** every token carries an organization; no behaviour depends on
it. Revert = stop emitting claims; tokens remain valid.

### Phase 3 — event contracts v2 (9.3)

`organizationId` required on the v2 envelope. Publish **both** v1 and v2
during the compatibility window (ADR 0005 forbids mutating a contract in
place). Consumers keep reading v1.

**Checkpoint:** both versions on the bus, nothing consuming v2 yet. Revert =
stop publishing v2.

### Phase 4 — nullable columns and backfill (9.3)

Add `organization_id` nullable to all ten organization-owned tables. Backfill
every existing row to the bootstrap organization. audit_events per event type
with an explicit map and logged misses (R4).

**Verify before proceeding:** row counts per table before and after are
identical; zero nulls remain; no row references an organization that does not
exist; spot-check that ticket → comments → history all agree on the
organization.

**Checkpoint:** columns exist and are fully populated but nothing reads them.
Revert = drop the columns.

### Phase 5 — read paths (9.3)

Repository signatures take a **required** scope. Delete `isStaff`/`isAdmin`
(R6) and fix every resulting compile error. Enumerate use cases against the
check so `AssignTicketUseCase` is not missed (R3). Scope the users-service
directory, the audit filter and all five analytics aggregates in one commit
each (R5).

The Phase 0 tests must now pass.

**Checkpoint:** reads are tenant-safe; writes still accept anything. Revert =
revert the commits; columns and data survive.

### Phase 6 — write paths and consumers (9.4)

Writes set the organization from the actor's claim, never from input.
Consumers read v2 and reject envelopes with no organization (R15/T15).
notification-service compares tenant as well as id. Membership lifecycle:
invite, activate, suspend, deactivate, with refresh revalidation (R7).

**Checkpoint:** the platform is tenant-safe on both paths while columns are
still nullable. Revert = still possible.

### Phase 7 — enforce (9.4)

Only after the verification in phase 4 has been re-run and passes: set
`NOT NULL`, add composite indexes with `organization_id` first, and make the
scope non-optional in every remaining type.

**Checkpoint:** the database now refuses an untenanted row. **This is the
first irreversible step** — reverting past it requires making columns nullable
again, which is safe but is a migration rather than a code revert.

### Phase 8 — legacy cleanup (9.4)

Stop publishing v1 events once every consumer reads v2. Remove the `roles`
compatibility claim once every call site reads `perms`. Scope the documented
rebuild paths and update `data-ownership.md` in the same change (R13). Fix the
stale line at `data-ownership.md:44` while there.

**Checkpoint:** no compatibility scaffolding remains.

## Rollback and recovery

- **Phases 0–6 are code reverts.** Columns are nullable and populated; the
  application simply stops reading them.
- **Phase 7 is the boundary.** After it, rollback is a forward migration
  making columns nullable again — safe, but not a `git revert`.
- **No phase deletes data.** Backfill is additive. If a backfill is wrong, the
  fix is to re-run it, which is why phase 4's verification queries are part of
  the plan and not an afterthought.
- **The bootstrap organization is never deleted.** Every pre-migration row
  belongs to it permanently; it is the recovery anchor for anything whose
  tenant cannot be re-derived.

## Explicitly not in this plan

Cache migration — there is nothing to migrate. Redis is connected to nothing
and no in-memory cache exists (T16). The requirement is a convention for the
first cache key, recorded now so it is not discovered later.
