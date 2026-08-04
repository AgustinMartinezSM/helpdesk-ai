-- Rekey user_snapshots on the MEMBERSHIP EDGE (Sprint 10.7, ADR 0026).
--
-- WHAT WAS WRONG. The table was keyed on user_id alone with a nullable
-- organization_id: a registration inserted the row untenanted and the first
-- membership.created.v1 stamped a tenant in, but only WHERE organization_id
-- IS NULL. The first membership every account ever gets is the BOOTSTRAP one
-- — organizations-service creates it while consuming that same registration
-- event — so the holding pen claimed every row and no later membership could
-- move it. GET /analytics/summary reported approximately ZERO users for every
-- real organization.
--
-- THIS SUPERSEDES, NEVER EDITS, the exemption stated in
-- 20260731154455_enforce_tenant_not_null: applied migrations are immutable
-- history. That migration exempted this column because registration is
-- anonymous. It still is — what changed is that this projection no longer
-- records registrations at all.
--
-- NO DEDUPE IS NEEDED, and that is worth stating because it is the first
-- thing a reviewer will ask: the old primary key on user_id guarantees at
-- most one row per user, so the composite key cannot collide on existing
-- data.
--
-- THIS MIGRATION REPAIRS NOTHING, and cannot. Which organizations a person
-- belongs to lives in helpdesk_organizations, and a service never reads a
-- peer's database (ADR 0003). Existing rows keep their bootstrap stamp and
-- every real organization keeps counting nobody until an operator runs
-- infrastructure/postgres/operations/backfill-user-snapshots.sh. Deleting the
-- rows instead would trade a wrong number for a zero, since consumed events
-- are gone and there is no outbox (ADR 0006) — nothing would re-create them.
--
-- DEPLOY ORDERING IS NOT OPTIONAL. This migration and the code change land
-- together. A deploy with the column NOT NULL while analytics-service is
-- still bound to user.registered.v1 dead-letters EVERY registration, because
-- that handler passes no organization at all — precisely the failure that
-- forced audit_events to be exempted during phase 7 itself.

-- Rows that never received a membership stamp. They count for nothing today
-- (every aggregate filters on organization_id, so a null falls out) and there
-- is no tenant to key them on, so they cannot survive the composite key.
DELETE FROM "user_snapshots" WHERE "organization_id" IS NULL;

ALTER TABLE "user_snapshots" ALTER COLUMN "organization_id" SET NOT NULL;

ALTER TABLE "user_snapshots" DROP CONSTRAINT "user_snapshots_pkey";

ALTER TABLE "user_snapshots"
    ADD CONSTRAINT "user_snapshots_pkey" PRIMARY KEY ("user_id", "organization_id");

-- registered_at meant "when this person signed up" while one row stood for
-- one person. Every row now describes one membership, so the honest name is
-- when they joined THAT organization — which is already the value the
-- membership create path wrote.
ALTER TABLE "user_snapshots" RENAME COLUMN "registered_at" TO "joined_at";
