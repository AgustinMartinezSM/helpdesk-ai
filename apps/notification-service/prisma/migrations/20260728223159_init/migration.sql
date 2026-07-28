-- CreateTable
CREATE TABLE "ticket_refs" (
    "ticket_id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,

    CONSTRAINT "ticket_refs_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "ticket_id" UUID NOT NULL,
    "message" TEXT NOT NULL,
    "source_event_id" UUID NOT NULL,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_user_id_source_event_id_key" ON "notifications"("user_id", "source_event_id");
