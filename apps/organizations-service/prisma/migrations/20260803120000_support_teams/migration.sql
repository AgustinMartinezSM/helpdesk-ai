-- Support teams (Sprint 9.12, ADR 0022).
--
-- A support team is the operational group that resolves a ticket. It is
-- ORGANIZATION-owned, not branch-owned: that is what lets one central IT team
-- serve every store. It is deliberately NOT a department — a department is
-- the requester's organizational area and belongs to exactly one branch.
--
-- Additive only. Nothing existing changes, and an organization that defines
-- no team is in exactly the state it was before this migration.

CREATE TABLE "support_teams" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_teams_pkey" PRIMARY KEY ("id")
);

-- Unique per organization, never globally: every organization may have an
-- "it" team.
CREATE UNIQUE INDEX "support_teams_organization_id_code_key"
    ON "support_teams"("organization_id", "code");

-- Membership x team. A DIFFERENT join from department_memberships on purpose:
-- tickets.read_team derives from this one and never from that one.
CREATE TABLE "support_team_memberships" (
    "team_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_team_memberships_pkey" PRIMARY KEY ("team_id", "membership_id")
);

-- Team x branch. NO ROWS MEANS ORGANIZATION-WIDE: the absence is the meaning,
-- not a missing configuration. Rows limit the team to exactly those branches,
-- which is how a regional team over three of five stores exists without one
-- team per store.
CREATE TABLE "support_team_branches" (
    "team_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_team_branches_pkey" PRIMARY KEY ("team_id", "branch_id")
);

CREATE INDEX "support_team_memberships_membership_id_idx"
    ON "support_team_memberships"("membership_id");

ALTER TABLE "support_teams" ADD CONSTRAINT "support_teams_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_team_memberships" ADD CONSTRAINT "support_team_memberships_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "support_teams"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_team_memberships" ADD CONSTRAINT "support_team_memberships_membership_id_fkey"
    FOREIGN KEY ("membership_id") REFERENCES "memberships"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_team_branches" ADD CONSTRAINT "support_team_branches_team_id_fkey"
    FOREIGN KEY ("team_id") REFERENCES "support_teams"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_team_branches" ADD CONSTRAINT "support_team_branches_branch_id_fkey"
    FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
