-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "organization_id" UUID;

-- AlterTable
ALTER TABLE "ticket_refs" ADD COLUMN     "organization_id" UUID;

-- Backfill: every row that exists right now belongs to the bootstrap
-- organization, because it is the only one there is and every one of these
-- rows predates the concept of a second.
--
-- The literal below is the bootstrap organization's id, created by
-- apps/organizations-service/prisma/migrations/20260730161500_bootstrap_organization.
-- It is repeated here rather than looked up because organizations live in
-- another service's database (ADR 0003) and a migration cannot join across
-- one. That is exactly why the id is fixed and obviously synthetic instead of
-- randomly generated.
--
-- Scoped to NULL so re-running is a no-op and never overwrites a value some
-- later phase set deliberately.

UPDATE "ticket_refs" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;

UPDATE "notifications" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;
