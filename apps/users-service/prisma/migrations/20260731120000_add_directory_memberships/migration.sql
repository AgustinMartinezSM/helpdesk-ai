-- CreateTable
CREATE TABLE "directory_memberships" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_template" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "directory_memberships_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateIndex
CREATE INDEX "directory_memberships_user_id_idx" ON "directory_memberships"("user_id");
