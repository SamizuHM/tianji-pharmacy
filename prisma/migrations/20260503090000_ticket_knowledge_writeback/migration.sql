-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "knowledgeStatus" TEXT NOT NULL DEFAULT 'not_ready';

-- CreateTable
CREATE TABLE "TicketKnowledgeDraft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ticketId" TEXT NOT NULL,
    "selectedMaterialsJson" TEXT NOT NULL,
    "categoryL1" TEXT NOT NULL,
    "categoryL2" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tagsJson" TEXT,
    "imagePathsJson" TEXT,
    "generatedByUserId" TEXT NOT NULL,
    "confirmedAt" DATETIME,
    "writtenKnowledgeItemId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TicketKnowledgeDraft_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TicketKnowledgeDraft_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Ticket_knowledgeStatus_idx" ON "Ticket"("knowledgeStatus");

-- CreateIndex
CREATE INDEX "TicketKnowledgeDraft_ticketId_createdAt_idx" ON "TicketKnowledgeDraft"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketKnowledgeDraft_writtenKnowledgeItemId_idx" ON "TicketKnowledgeDraft"("writtenKnowledgeItemId");
