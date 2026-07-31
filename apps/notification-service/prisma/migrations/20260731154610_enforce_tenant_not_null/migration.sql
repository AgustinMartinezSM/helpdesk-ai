-- Phase 7: enforce NOT NULL on the tenant columns.
--
-- The constraint is a net under behavior the code already enforces — every
-- row is written by a v2 event whose envelope carries the organization — not
-- new behavior. Each ALTER is preceded by an idempotent guard UPDATE: a
-- no-op when the precondition (zero untenanted rows, verified by
-- infrastructure/postgres/operations/verify-tenant-columns.sh) holds, and
-- insurance when it does not, so the migration cannot fail halfway on a row
-- the operator sequence missed.
--
-- The guard assigns the bootstrap organization
-- (apps/organizations-service/prisma/migrations/20260730161500_bootstrap_organization),
-- which is only valid while it is the ONLY organization — a rule this
-- migration's timestamp pins historically: any row that is null here predates
-- the possibility of a second tenant.
--
-- No new index: the scoped list is covered by
-- [user_id, organization_id, created_at] (20260731151205), and ticket_refs
-- is only ever read by its primary key.

-- AlterTable
UPDATE "notifications" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;

ALTER TABLE "notifications" ALTER COLUMN "organization_id" SET NOT NULL;

-- AlterTable
UPDATE "ticket_refs" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;

ALTER TABLE "ticket_refs" ALTER COLUMN "organization_id" SET NOT NULL;
