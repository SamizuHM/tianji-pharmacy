-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('staff', 'agent');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'agent', 'system');

-- CreateEnum
CREATE TYPE "MessageSourceType" AS ENUM ('kb', 'llm', 'manual', 'system');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('pending_claim', 'processing', 'escalated', 'closed');

-- CreateEnum
CREATE TYPE "TicketPriority" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "TicketMessageType" AS ENUM ('text', 'image', 'system');

-- CreateEnum
CREATE TYPE "TicketKnowledgeStatus" AS ENUM ('not_ready', 'pending_writeback', 'written');

-- CreateEnum
CREATE TYPE "MessageFeedback" AS ENUM ('helpful', 'unhelpful');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('seed_doc', 'image_doc', 'manual_ticket', 'manual');

-- CreateEnum
CREATE TYPE "KnowledgeStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "ImportJobStatus" AS ENUM ('pending', 'running', 'success', 'failed');

-- CreateEnum
CREATE TYPE "KnowledgeIndexTaskType" AS ENUM ('upsert', 'delete');

-- CreateEnum
CREATE TYPE "KnowledgeIndexTaskStatus" AS ENUM ('pending', 'processing', 'completed');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "departmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "sourceType" "MessageSourceType" NOT NULL,
    "contentText" TEXT NOT NULL,
    "attachmentsJson" TEXT,
    "retrievalDebugJson" TEXT,
    "feedback" "MessageFeedback",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "ticketNo" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL,
    "priority" "TicketPriority" NOT NULL DEFAULT 'medium',
    "createdByUserId" TEXT NOT NULL,
    "conversationId" TEXT,
    "title" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '门店问答',
    "tagsJson" TEXT,
    "latestUserQuestion" TEXT NOT NULL,
    "inputMode" TEXT NOT NULL,
    "aiAnswerSnapshot" TEXT NOT NULL,
    "conversationSnapshot" TEXT NOT NULL,
    "resolutionText" TEXT,
    "firstRespondedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "escalatedToDept" TEXT,
    "escalatedToUserId" TEXT,
    "satisfactionScore" INTEGER,
    "knowledgeStatus" "TicketKnowledgeStatus" NOT NULL DEFAULT 'not_ready',
    "claimedByUserId" TEXT,
    "resolutionSubmittedAt" TIMESTAMP(3),
    "resolutionSubmittedByUserId" TEXT,
    "closedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "senderRole" "MessageRole" NOT NULL,
    "senderUserId" TEXT,
    "messageType" "TicketMessageType" NOT NULL,
    "content" TEXT NOT NULL,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketKnowledgeDraft" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "selectedMaterialsJson" TEXT NOT NULL,
    "categoryL1" TEXT NOT NULL,
    "categoryL2" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tagsJson" TEXT,
    "imagePathsJson" TEXT,
    "generatedByUserId" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "writtenKnowledgeItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TicketKnowledgeDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL,
    "categoryL1" TEXT NOT NULL,
    "categoryL2" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tagsJson" TEXT,
    "status" "KnowledgeStatus" NOT NULL DEFAULT 'published',
    "sourceType" "KnowledgeSourceType" NOT NULL,
    "sourceTicketId" TEXT,
    "sourceFile" TEXT,
    "docType" TEXT,
    "imagePath" TEXT,
    "imagePathsJson" TEXT,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "knowledgeItemId" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "chunkText" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "sourceFile" TEXT,
    "docType" TEXT,
    "qdrantPointId" TEXT NOT NULL,
    "metadataJson" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeIndexTask" (
    "id" TEXT NOT NULL,
    "taskType" "KnowledgeIndexTaskType" NOT NULL,
    "status" "KnowledgeIndexTaskStatus" NOT NULL DEFAULT 'pending',
    "knowledgeItemId" TEXT,
    "chunkId" TEXT,
    "pointId" TEXT NOT NULL,
    "payloadJson" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeIndexTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Conversation_userId_deletedAt_updatedAt_idx" ON "Conversation"("userId", "deletedAt", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_feedback_idx" ON "ChatMessage"("feedback");

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_ticketNo_key" ON "Ticket"("ticketNo");

-- CreateIndex
CREATE INDEX "Ticket_status_createdAt_idx" ON "Ticket"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_claimedByUserId_idx" ON "Ticket"("claimedByUserId");

-- CreateIndex
CREATE INDEX "Ticket_priority_createdAt_idx" ON "Ticket"("priority", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_category_idx" ON "Ticket"("category");

-- CreateIndex
CREATE INDEX "Ticket_knowledgeStatus_idx" ON "Ticket"("knowledgeStatus");

-- CreateIndex
CREATE INDEX "TicketMessage_ticketId_createdAt_idx" ON "TicketMessage"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketKnowledgeDraft_ticketId_createdAt_idx" ON "TicketKnowledgeDraft"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "TicketKnowledgeDraft_writtenKnowledgeItemId_idx" ON "TicketKnowledgeDraft"("writtenKnowledgeItemId");

-- CreateIndex
CREATE INDEX "KnowledgeItem_categoryL1_categoryL2_idx" ON "KnowledgeItem"("categoryL1", "categoryL2");

-- CreateIndex
CREATE INDEX "KnowledgeItem_sourceType_createdAt_idx" ON "KnowledgeItem"("sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeItem_status_updatedAt_idx" ON "KnowledgeItem"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "KnowledgeItem_hitCount_idx" ON "KnowledgeItem"("hitCount");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_qdrantPointId_key" ON "KnowledgeChunk"("qdrantPointId");

-- CreateIndex
CREATE INDEX "KnowledgeChunk_knowledgeItemId_chunkIndex_idx" ON "KnowledgeChunk"("knowledgeItemId", "chunkIndex");

-- CreateIndex
CREATE INDEX "KnowledgeIndexTask_status_availableAt_createdAt_idx" ON "KnowledgeIndexTask"("status", "availableAt", "createdAt");

-- CreateIndex
CREATE INDEX "KnowledgeIndexTask_chunkId_idx" ON "KnowledgeIndexTask"("chunkId");

-- CreateIndex
CREATE INDEX "KnowledgeIndexTask_knowledgeItemId_idx" ON "KnowledgeIndexTask"("knowledgeItemId");

-- CreateIndex
CREATE INDEX "KnowledgeIndexTask_pointId_idx" ON "KnowledgeIndexTask"("pointId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSetting_key_key" ON "AppSetting"("key");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_closedByUserId_fkey" FOREIGN KEY ("closedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_escalatedToUserId_fkey" FOREIGN KEY ("escalatedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_resolutionSubmittedByUserId_fkey" FOREIGN KEY ("resolutionSubmittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketMessage" ADD CONSTRAINT "TicketMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketKnowledgeDraft" ADD CONSTRAINT "TicketKnowledgeDraft_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketKnowledgeDraft" ADD CONSTRAINT "TicketKnowledgeDraft_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_knowledgeItemId_fkey" FOREIGN KEY ("knowledgeItemId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

