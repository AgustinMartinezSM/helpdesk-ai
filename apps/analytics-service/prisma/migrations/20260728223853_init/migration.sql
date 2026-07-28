-- CreateTable
CREATE TABLE "ticket_snapshots" (
    "ticket_id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "priority" TEXT,
    "created_at" TIMESTAMPTZ(3),
    "resolved_at" TIMESTAMPTZ(3),
    "last_event_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ticket_snapshots_pkey" PRIMARY KEY ("ticket_id")
);

-- CreateTable
CREATE TABLE "user_snapshots" (
    "user_id" UUID NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_snapshots_pkey" PRIMARY KEY ("user_id")
);

-- CreateIndex
CREATE INDEX "ticket_snapshots_status_idx" ON "ticket_snapshots"("status");
