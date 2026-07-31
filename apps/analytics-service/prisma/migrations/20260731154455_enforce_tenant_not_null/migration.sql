-- Phase 7: enforce NOT NULL on the tenant column of ticket_snapshots.
--
-- The constraint is a net under behavior the code already enforces — every
-- projecting event carries its tenant — not new behavior. The ALTER is
-- preceded by an idempotent guard UPDATE: a no-op when the precondition
-- (zero untenanted rows, verified by
-- infrastructure/postgres/operations/verify-tenant-columns.sh) holds, and
-- insurance when it does not, so the migration cannot fail on a row the
-- operator sequence missed.
--
-- The guard assigns the bootstrap organization
-- (apps/organizations-service/prisma/migrations/20260730161500_bootstrap_organization),
-- which is only valid while it is the ONLY organization — a rule this
-- migration's timestamp pins historically: any row that is null here predates
-- the possibility of a second tenant.
--
-- user_snapshots is EXEMPT on purpose: registration is anonymous
-- (user.registered.v1 is structurally tenantless — the membership that would
-- supply a tenant is created by consuming that very event), so its column
-- stays nullable by design and every scoped aggregate already excludes nulls.
--
-- No new index: both dashboards' aggregates filter on organization_id alone,
-- covered by the existing single-column indexes from
-- 20260731120000_scope_analytics_to_organization.

-- AlterTable
UPDATE "ticket_snapshots" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;

ALTER TABLE "ticket_snapshots" ALTER COLUMN "organization_id" SET NOT NULL;
