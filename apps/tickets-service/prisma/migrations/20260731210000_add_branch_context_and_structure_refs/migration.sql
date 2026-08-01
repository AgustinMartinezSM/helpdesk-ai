-- Sprint 9.5: ticket branch/station context (ADR 0016) and the local
-- projection of organizations-service's structure (D4).
--
-- The tickets columns are nullable and STAY nullable: a ticket without a
-- branch is the eight-person shop with nothing to configure — a permanently
-- legitimate state, not a backfill debt. No NOT NULL arrives in any later
-- phase of this sprint, unlike the organization_id columns before them.
--
-- branch_refs / station_refs are projections of structure another service
-- owns. Ticket creation is a hot path, so it validates branch context
-- against these local rows instead of asking organizations-service
-- synchronously — ADR 0014's mutations-may-ask exception deliberately does
-- not apply here. The rows arrive by consuming branch.*/station.* events.
-- Every id is opaque and carries no foreign key, on tickets or between the
-- ref tables, because the authoritative rows live in another service's
-- database (ADR 0003).

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN "branch_id" UUID;

ALTER TABLE "tickets" ADD COLUMN "operational_station_id" UUID;

-- CreateIndex: the branch-scoped list's exact shape — WHERE organization_id
-- AND branch_id IN (the caller's branch set).
CREATE INDEX "tickets_organization_id_branch_id_idx" ON "tickets"("organization_id", "branch_id");

-- CreateTable
CREATE TABLE "branch_refs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: the picker's and the create-validation's shape — active
-- branches of one tenant.
CREATE INDEX "branch_refs_organization_id_status_idx" ON "branch_refs"("organization_id", "status");

-- CreateTable
CREATE TABLE "station_refs" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "status" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "station_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "station_refs_branch_id_idx" ON "station_refs"("branch_id");
