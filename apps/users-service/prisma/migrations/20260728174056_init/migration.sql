-- CreateTable
CREATE TABLE "user_profiles" (
    "user_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "roles" TEXT[],
    "registered_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_email_key" ON "user_profiles"("email");
