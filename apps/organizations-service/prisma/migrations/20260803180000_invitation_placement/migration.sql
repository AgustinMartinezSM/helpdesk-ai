-- Sprint 9.15 — an invitation can carry where the person will work.
--
-- Additive and nullable, no backfill: every existing invitation keeps working
-- with both columns null, which is exactly what the single-invitation form
-- keeps producing. Only the CSV import populates them, and redemption applies
-- them in the transaction that already inserts the membership.
--
-- Real foreign keys, unlike every cross-service identifier in this platform,
-- because branches and departments live in THIS database (ADR 0013). That is
-- what makes "the department belongs to that branch" enforceable rather than
-- merely checked by whoever wrote the import.
--
-- ON DELETE SET NULL rather than CASCADE: removing a branch must not destroy a
-- pending invitation somebody is waiting to redeem. They join without a
-- placement, which an administrator can fix afterwards; the alternative burns
-- a code that cannot be reissued (the secret is not derivable from anything).
ALTER TABLE "invitations"
  ADD COLUMN "branch_id" UUID,
  ADD COLUMN "department_id" UUID;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_department_id_fkey"
  FOREIGN KEY ("department_id") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
