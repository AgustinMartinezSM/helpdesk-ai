-- Sprint 9.6 (ADR 0018): user_profiles becomes a HYBRID table. user_id,
-- email and registered_at remain the identity seed projected from
-- user.registered.v1 — the registration consumer owns them and keeps
-- upserting them on replay. Every other profile column is source of truth
-- owned by the HTTP API: the consumer must never write them, and a pinned
-- test proves a replayed registration leaves them alone. display_name
-- crosses the line here: still seeded on create from the email's local
-- part, user-owned from then on. From this migration on, this database is
-- no longer disposable.

-- AlterTable
ALTER TABLE "user_profiles"
ADD COLUMN "preferred_name" TEXT,
ADD COLUMN "phone" TEXT,
ADD COLUMN "language" TEXT,
ADD COLUMN "timezone" TEXT;

-- Organization-defined field definitions (D2/D3). organization_id is an
-- opaque identifier issued by organizations-service, never a cross-database
-- foreign key (ADR 0003). "validation" holds the closed, per-type
-- DECLARATIVE object (length/pattern/min/max/options) — data, never code.
-- CreateTable
CREATE TABLE "organization_profile_fields" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label_es_ar" TEXT NOT NULL,
    "label_en_us" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "editable_by_user" BOOLEAN NOT NULL DEFAULT false,
    "visible_to_requester" BOOLEAN NOT NULL DEFAULT true,
    "visible_to_staff" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL,
    "validation" JSONB,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_profile_fields_pkey" PRIMARY KEY ("id")
);

-- One value per (field, user). organization_id is denormalized on purpose:
-- every read is org-first, and the field_id FK alone would force a join
-- just to know the tenant a value belongs to.
-- CreateTable
CREATE TABLE "profile_field_values" (
    "field_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "profile_field_values_pkey" PRIMARY KEY ("field_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_profile_fields_organization_id_key_key" ON "organization_profile_fields"("organization_id", "key");

-- CreateIndex (named by hand: the generated name would exceed Postgres's
-- 63-character identifier limit and be truncated silently)
CREATE INDEX "organization_profile_fields_org_status_order_idx" ON "organization_profile_fields"("organization_id", "status", "display_order");

-- CreateIndex
CREATE INDEX "profile_field_values_organization_id_user_id_idx" ON "profile_field_values"("organization_id", "user_id");

-- AddForeignKey (real FK inside one database — half the reason definitions
-- and values live together, ADR 0018; deleting a definition removes its
-- values with it)
ALTER TABLE "profile_field_values" ADD CONSTRAINT "profile_field_values_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "organization_profile_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;
