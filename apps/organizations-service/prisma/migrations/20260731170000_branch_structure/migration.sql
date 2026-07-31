-- Sprint 9.5: branches, departments and operational stations (ADR 0016).
--
-- Two loads this schema carries, stated once here because every table below
-- leans on one of them:
--
-- A branch is a SCOPE. It constrains what a person may see, so it is an
-- authorization input, and authorization inputs live in this database next
-- to memberships (ADR 0013) where the edges are real foreign keys.
--
-- An operational station is CONTEXT, never a principal (ADR 0016/0017). It
-- authenticates nothing, holds no credential, and never appears as an actor;
-- it is a registered place a request can name — the till, not the cashier.
--
-- All additive: no backfill, no NOT NULL on existing tables, rollback is a
-- code revert plus dropping empty tables.

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "timezone" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operational_stations" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "area" TEXT,
    "responsible_membership_id" UUID,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "operational_stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable: membership × branch, the join ADR 0016 chose over a branch_id
-- column so a regional manager covers several stores on one membership.
-- Deliberately WITHOUT the scope qualifier column the ADR was unsure about
-- (Sprint 9.5, D3): the role template on the membership carries the meaning,
-- and the ADR amendment recording that outcome lands with the sprint's docs
-- pass.
CREATE TABLE "branch_memberships" (
    "membership_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branch_memberships_pkey" PRIMARY KEY ("membership_id","branch_id")
);

-- CreateTable
CREATE TABLE "department_memberships" (
    "membership_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "department_memberships_pkey" PRIMARY KEY ("membership_id","department_id")
);

-- CreateIndex: codes and names are unique per parent, never globally —
-- every chain has a "store-1".
CREATE UNIQUE INDEX "branches_organization_id_code_key" ON "branches"("organization_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "departments_branch_id_name_key" ON "departments"("branch_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "operational_stations_branch_id_code_key" ON "operational_stations"("branch_id", "code");

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "operational_stations" ADD CONSTRAINT "operational_stations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: SET NULL, not CASCADE — the responsible manager answers for
-- the place; losing them must never take the station down with them.
ALTER TABLE "operational_stations" ADD CONSTRAINT "operational_stations_responsible_membership_id_fkey" FOREIGN KEY ("responsible_membership_id") REFERENCES "memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_memberships" ADD CONSTRAINT "branch_memberships_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_memberships" ADD CONSTRAINT "branch_memberships_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "department_memberships" ADD CONSTRAINT "department_memberships_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
