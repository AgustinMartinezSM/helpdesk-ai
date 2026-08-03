-- Support team routing (Sprint 9.12, ADR 0022).
--
-- Additive and nullable. EVERY EXISTING TICKET KEEPS A NULL TEAM and behaves
-- exactly as it did before: a ticket nobody has routed is a permanently
-- legitimate state, not a gap to backfill.
--
-- The team a ticket is assigned to is the group that RESOLVES it. It is not
-- the requester's department, which is a separate concept with no column
-- here yet.

ALTER TABLE "tickets" ADD COLUMN "assigned_team_id" UUID;

CREATE INDEX "tickets_organization_id_assigned_team_id_idx"
    ON "tickets"("organization_id", "assigned_team_id");

-- Projection of organizations-service's support teams, fed by events. Not a
-- source of truth: it rebuilds from the log.
CREATE TABLE "team_refs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "team_refs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "team_refs_organization_id_status_idx"
    ON "team_refs"("organization_id", "status");

-- NO ROWS FOR A TEAM MEANS ORGANIZATION-WIDE.
CREATE TABLE "team_branch_refs" (
    "team_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,

    CONSTRAINT "team_branch_refs_pkey" PRIMARY KEY ("team_id", "branch_id")
);

ALTER TABLE "team_branch_refs" ADD CONSTRAINT "team_branch_refs_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "team_refs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
