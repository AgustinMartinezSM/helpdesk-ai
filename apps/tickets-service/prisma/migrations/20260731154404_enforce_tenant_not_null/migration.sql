-- Phase 7: enforce NOT NULL on the tenant columns.
--
-- The constraint is a net under behavior the code already enforces — every
-- write path takes the organization from the token — not new behavior. Each
-- ALTER is preceded by an idempotent guard UPDATE: a no-op when the
-- precondition (zero untenanted rows, verified by
-- infrastructure/postgres/operations/verify-tenant-columns.sh) holds, and
-- insurance when it does not, so the migration cannot fail halfway on a row
-- the operator sequence missed.
--
-- The guard assigns the bootstrap organization
-- (apps/organizations-service/prisma/migrations/20260730161500_bootstrap_organization),
-- which is only valid while it is the ONLY organization — a rule this
-- migration's timestamp pins historically: any row that is null here predates
-- the possibility of a second tenant.

-- AlterTable
UPDATE "ticket_comments" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;

ALTER TABLE "ticket_comments" ALTER COLUMN "organization_id" SET NOT NULL;

-- AlterTable
UPDATE "ticket_history" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;

ALTER TABLE "ticket_history" ALTER COLUMN "organization_id" SET NOT NULL;

-- AlterTable
UPDATE "tickets" SET "organization_id" = '00000000-0000-4000-8000-000000000001' WHERE "organization_id" IS NULL;

ALTER TABLE "tickets" ALTER COLUMN "organization_id" SET NOT NULL;

-- CreateIndex: serves the scoped list — WHERE organization_id (optionally
-- narrowed by requester/assignee/status), ORDER BY created_at — which until
-- now had no index starting with the tenant.
CREATE INDEX "tickets_organization_id_created_at_idx" ON "tickets"("organization_id", "created_at");
