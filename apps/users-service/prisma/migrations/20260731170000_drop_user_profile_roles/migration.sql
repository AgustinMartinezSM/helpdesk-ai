-- Phase 8: drop the projected global roles from the directory.
--
-- The column was R14's copy of auth-service's global roles, stamped once
-- from user.registered.v1 and never updated after — a stale snapshot by
-- design. The membership role templates in organizations-service superseded
-- it as the tenant-scoped answer to "what is this person here", and the
-- directory stopped meaning anything by these values the moment
-- authorization went permission-based: nothing read them, nothing missed
-- them.

-- AlterTable
ALTER TABLE "user_profiles" DROP COLUMN "roles";
