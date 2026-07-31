-- The scoped read path filters every listing by organization_id and orders
-- by occurred_at; this index keeps that query off a sequential scan once the
-- trail outgrows toy size. Rows still NULL here (v1-era envelopes awaiting
-- the operator backfill) are never matched by the scoped read at all.

-- CreateIndex
CREATE INDEX "audit_events_organization_id_occurred_at_idx" ON "audit_events"("organization_id", "occurred_at");
