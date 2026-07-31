-- Replaced, not supplemented: every notification read now filters on the
-- caller's organization as well as their user id, so (user_id, created_at)
-- no longer matches any query this service issues. The new index is the
-- scoped list's exact shape — WHERE user_id AND organization_id, ORDER BY
-- created_at. The (user_id, source_event_id) dedupe key is untouched:
-- source_event_id is a per-envelope uuid, globally unique, so the pair
-- cannot collide across tenants.

-- DropIndex
DROP INDEX "notifications_user_id_created_at_idx";

-- CreateIndex
CREATE INDEX "notifications_user_id_organization_id_created_at_idx" ON "notifications"("user_id", "organization_id", "created_at");
