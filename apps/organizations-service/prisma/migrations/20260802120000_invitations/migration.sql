-- Sprint 9.8: invitations (ADR 0019).
--
-- A redeemable offer of membership. It is not an account and not a credential
-- for one: redeeming requires already being authenticated as the addressed
-- person, and that person's password is created by them. There is deliberately
-- no column that could hold a password, temporary or otherwise — ADR 0016
-- forbids the permanent shared password this table would otherwise invite.
--
-- Only the sha256 of the code's secret half is stored. The code itself exists
-- in exactly one HTTP response, is never logged and never travels in an event,
-- which also means this table is NOT reconstructible from anything: there can
-- be no reissue path for a code already handed out (data-ownership.md).
--
-- Additive: one new table, no backfill, no NOT NULL on an existing table.
-- Rollback is a code revert plus DROP TABLE — except memberships created by a
-- redemption in between, which are ordinary memberships and stay.

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "invitee_email" TEXT NOT NULL,
    "role_template" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_by_user_id" UUID,
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invitations_organization_id_invitee_email_idx" ON "invitations"("organization_id", "invitee_email");

-- CreateIndex
CREATE INDEX "invitations_organization_id_status_created_at_idx" ON "invitations"("organization_id", "status", "created_at");

-- One PENDING invitation per address per organization, enforced by the
-- database rather than by a read-then-write that two concurrent issues could
-- both pass. Partial, because accepted and revoked rows are kept forever as
-- the record of who was invited and what became of it — a plain unique index
-- would make the second invitation of a person who left impossible.
--
-- Raw SQL: Prisma's schema language cannot express a partial index, so the
-- model carries a plain @@index and this is where the uniqueness actually
-- lives. Do not "simplify" the model to @@unique — it would generate a total
-- unique index and break re-invitation.
CREATE UNIQUE INDEX "invitations_pending_invitee_email_key" ON "invitations"("organization_id", "invitee_email") WHERE "status" = 'pending';

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
