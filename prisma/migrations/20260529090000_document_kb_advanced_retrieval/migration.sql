-- CreateEnum
ALTER TYPE "KnowledgeSourceType" ADD VALUE IF NOT EXISTS 'uploaded_doc';
ALTER TYPE "KnowledgeSourceType" ADD VALUE IF NOT EXISTS 'manual_qa';

CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('draft', 'published', 'archived');
CREATE TYPE "KnowledgeParserType" AS ENUM ('basic_text', 'pdf_text', 'docx_layout', 'image_vlm', 'legacy_qa');
CREATE TYPE "KnowledgeParseRunStatus" AS ENUM ('pending', 'running', 'success', 'failed');
CREATE TYPE "KnowledgeChunkStrategy" AS ENUM ('fixed_overlap', 'recursive', 'heading', 'qa', 'page', 'parent_child');
CREATE TYPE "KnowledgeAnswerPolicy" AS ENUM ('allow_llm_fallback', 'kb_only');
CREATE TYPE "KnowledgeScopeLevel" AS ENUM ('national', 'province', 'city', 'district', 'store');

-- CreateTable
CREATE TABLE "Store" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provinceCode" TEXT,
  "provinceName" TEXT,
  "cityCode" TEXT,
  "cityName" TEXT,
  "districtCode" TEXT,
  "districtName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocument" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "sourceType" "KnowledgeSourceType" NOT NULL,
  "sourceFile" TEXT,
  "mimeType" TEXT,
  "businessCategory" TEXT NOT NULL DEFAULT '通用',
  "answerPolicy" "KnowledgeAnswerPolicy" NOT NULL DEFAULT 'allow_llm_fallback',
  "scopeLevel" "KnowledgeScopeLevel" NOT NULL DEFAULT 'national',
  "provinceCode" TEXT,
  "provinceName" TEXT,
  "cityCode" TEXT,
  "cityName" TEXT,
  "districtCode" TEXT,
  "districtName" TEXT,
  "storeId" TEXT,
  "effectiveFrom" TIMESTAMP(3),
  "effectiveTo" TIMESTAMP(3),
  "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'draft',
  "hitCount" INTEGER NOT NULL DEFAULT 0,
  "lastHitAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeDocumentVersion" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "originalFilePath" TEXT,
  "sourceFileName" TEXT,
  "contentHash" TEXT NOT NULL,
  "uploadedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeDocumentVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeParseRun" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "documentVersionId" TEXT NOT NULL,
  "parserType" "KnowledgeParserType" NOT NULL,
  "status" "KnowledgeParseRunStatus" NOT NULL DEFAULT 'pending',
  "extractedText" TEXT,
  "structuredJson" TEXT,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KnowledgeParseRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KnowledgeChunkSet" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "parseRunId" TEXT NOT NULL,
  "chunkStrategy" "KnowledgeChunkStrategy" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeChunkSet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AnswerPolicyRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "businessCategory" TEXT NOT NULL,
  "matchTermsJson" TEXT,
  "answerPolicy" "KnowledgeAnswerPolicy" NOT NULL DEFAULT 'allow_llm_fallback',
  "minRerankScore" DOUBLE PRECISION,
  "minEvidenceCount" INTEGER NOT NULL DEFAULT 1,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AnswerPolicyRule_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "storeId" TEXT;

ALTER TABLE "KnowledgeItem" ADD COLUMN "documentId" TEXT;

ALTER TABLE "KnowledgeChunk"
  ADD COLUMN "documentId" TEXT,
  ADD COLUMN "chunkSetId" TEXT,
  ADD COLUMN "parentChunkId" TEXT,
  ADD COLUMN "sectionPath" TEXT,
  ADD COLUMN "pageStart" INTEGER,
  ADD COLUMN "pageEnd" INTEGER,
  ADD COLUMN "tokenCount" INTEGER,
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "Store_provinceCode_cityCode_districtCode_idx" ON "Store"("provinceCode", "cityCode", "districtCode");
CREATE INDEX "KnowledgeDocument_status_updatedAt_idx" ON "KnowledgeDocument"("status", "updatedAt");
CREATE INDEX "KnowledgeDocument_businessCategory_status_idx" ON "KnowledgeDocument"("businessCategory", "status");
CREATE INDEX "KnowledgeDocument_scopeLevel_provinceCode_cityCode_districtCode_storeId_idx" ON "KnowledgeDocument"("scopeLevel", "provinceCode", "cityCode", "districtCode", "storeId");
CREATE INDEX "KnowledgeDocumentVersion_documentId_createdAt_idx" ON "KnowledgeDocumentVersion"("documentId", "createdAt");
CREATE INDEX "KnowledgeDocumentVersion_contentHash_idx" ON "KnowledgeDocumentVersion"("contentHash");
CREATE INDEX "KnowledgeParseRun_documentId_createdAt_idx" ON "KnowledgeParseRun"("documentId", "createdAt");
CREATE INDEX "KnowledgeParseRun_status_createdAt_idx" ON "KnowledgeParseRun"("status", "createdAt");
CREATE INDEX "KnowledgeChunkSet_documentId_isActive_idx" ON "KnowledgeChunkSet"("documentId", "isActive");
CREATE INDEX "KnowledgeChunkSet_parseRunId_idx" ON "KnowledgeChunkSet"("parseRunId");
CREATE INDEX "AnswerPolicyRule_businessCategory_enabled_idx" ON "AnswerPolicyRule"("businessCategory", "enabled");
CREATE INDEX "KnowledgeItem_documentId_idx" ON "KnowledgeItem"("documentId");
CREATE INDEX "KnowledgeChunk_documentId_chunkIndex_idx" ON "KnowledgeChunk"("documentId", "chunkIndex");
CREATE INDEX "KnowledgeChunk_chunkSetId_chunkIndex_idx" ON "KnowledgeChunk"("chunkSetId", "chunkIndex");
CREATE INDEX "KnowledgeChunk_enabled_idx" ON "KnowledgeChunk"("enabled");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_chunkSetId_fkey" FOREIGN KEY ("chunkSetId") REFERENCES "KnowledgeChunkSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_parentChunkId_fkey" FOREIGN KEY ("parentChunkId") REFERENCES "KnowledgeChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeDocumentVersion" ADD CONSTRAINT "KnowledgeDocumentVersion_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeParseRun" ADD CONSTRAINT "KnowledgeParseRun_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeParseRun" ADD CONSTRAINT "KnowledgeParseRun_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "KnowledgeDocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunkSet" ADD CONSTRAINT "KnowledgeChunkSet_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "KnowledgeDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeChunkSet" ADD CONSTRAINT "KnowledgeChunkSet_parseRunId_fkey" FOREIGN KEY ("parseRunId") REFERENCES "KnowledgeParseRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
