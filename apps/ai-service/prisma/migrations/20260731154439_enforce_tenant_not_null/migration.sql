-- Phase 7: enforce NOT NULL on the tenant column.
--
-- The constraint is a net under behavior the code already enforces — the
-- write path takes the organization from the token — not new behavior. The
-- ALTER is preceded by an idempotent guard UPDATE: a no-op when the
-- precondition (zero untenanted rows, verified by
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
-- No new index: every suggestion read filters by ticket_id (already covered
-- by [ticket_id, task, created_at]); no query shape starts with the tenant.

-- AlterTable
UPDATE "suggestions" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;

ALTER TABLE "suggestions" ALTER COLUMN "organization_id" SET NOT NULL;
