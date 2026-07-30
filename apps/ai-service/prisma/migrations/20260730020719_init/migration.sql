-- CreateTable
CREATE TABLE "suggestions" (
    "id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "output" JSONB NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "context_hash" TEXT NOT NULL,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "latency_ms" INTEGER NOT NULL,
    "requested_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "suggestions_ticket_id_task_created_at_idx" ON "suggestions"("ticket_id", "task", "created_at");
