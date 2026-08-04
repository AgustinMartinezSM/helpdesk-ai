-- Project the membership's STATUS, so the headcount can go down
-- (Sprint 10.8, ADR 0026 amendment).
--
-- WHAT WAS WRONG. Sprint 10.7 rekeyed this table on the membership edge, so a
-- person is counted in every organization they belong to. What it did not do
-- — and said so in its own record — is give the projection any way to stop
-- counting somebody. MetricsConsumer subscribed to membership.created.v1 and
-- nothing else, there was no port method that updated or deleted a row, and
-- there was no column that could have held the answer. GET /analytics/summary
-- therefore reported everybody who had ever joined: suspend a person, remove a
-- person, remove everybody, and the number did not move.
--
-- WHAT COUNTS NOW. status = 'active', which is the same question the people
-- directory answers by default (users-service lists active members unless
-- ?status= widens it). A dashboard that answered a different question from the
-- screen listing the same people is the defect this repository keeps finding.
-- The filter names what counts rather than listing what does not, so a status
-- invented by a later sprint fails closed instead of being counted.
--
-- WHY THE ROW IS NEVER DELETED. deactivated stopped being terminal in Sprint
-- 9.10, so a delete would have to be undone by an insert whose joined_at
-- nobody has any more; and deleting discards last_event_at, which is what
-- makes a stale replayed suspension harmless rather than destructive.
--
-- WHAT THE BACKFILL BELOW IS, AND IS NOT. It is a RECONSTRUCTION, not a
-- default. Every row in this table was written by membership.created.v1, and
-- every membership creation path in the platform creates the membership
-- 'active' — invitation redemption, the bootstrap membership, and the
-- organization-creation owner. So 'active' is what the projection would have
-- stored at insert time, and last_event_at would have been that same created
-- event's timestamp, which joined_at already holds.
--
-- WHAT IT CANNOT RECONSTRUCT: any status change since. Nothing ever consumed
-- membership.status-changed.v1, so those events are gone and no replay exists
-- (ADR 0006, no outbox). An organization that has suspended people will keep
-- counting them until an operator runs
-- infrastructure/postgres/operations/backfill-user-snapshots.sh, which reads
-- current truth from helpdesk_organizations. Same statement Sprint 10.7 had to
-- make: the code is fixed, the existing numbers are not.
--
-- DEPLOY ORDERING. This migration and the consumer arm land together, as in
-- 10.7. The looser direction this time: an old binary against the new schema
-- would insert without status and fail on NOT NULL rather than write a wrong
-- number, which is the failure to prefer.

-- Added with a temporary default so the statement can run against a populated
-- table, then dropped: see WHAT THE BACKFILL BELOW IS.
ALTER TABLE "user_snapshots" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "user_snapshots" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "user_snapshots" ADD COLUMN "last_event_at" TIMESTAMPTZ(3);
UPDATE "user_snapshots" SET "last_event_at" = "joined_at" WHERE "last_event_at" IS NULL;
ALTER TABLE "user_snapshots" ALTER COLUMN "last_event_at" SET NOT NULL;

-- The only query on this table is "count active members of one organization".
-- The composite leads with organization_id, so it also serves the tenant-only
-- grouping the operator script runs, and the single-column index it replaces
-- would be redundant.
DROP INDEX "user_snapshots_organization_id_idx";
CREATE INDEX "user_snapshots_organization_id_status_idx"
    ON "user_snapshots"("organization_id", "status");
