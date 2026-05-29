ALTER TABLE "KnowledgeChunk" ADD COLUMN "scopeLevel" "KnowledgeScopeLevel" NOT NULL DEFAULT 'national';
ALTER TABLE "KnowledgeChunk" ADD COLUMN "cityCode" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "cityName" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "overrideScope" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "bm25SearchText" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "hypotheticalQuestionsJson" TEXT;

UPDATE "KnowledgeChunk" AS kc
SET
  "scopeLevel" = COALESCE(kd."scopeLevel", 'national'),
  "cityCode" = kd."cityCode",
  "cityName" = kd."cityName",
  "bm25SearchText" = CONCAT_WS(E'\n', kc."chunkText", ki."question", ki."answer", ki."categoryL1", ki."categoryL2", kc."sourceFile")
FROM "KnowledgeItem" ki
LEFT JOIN "KnowledgeDocument" kd ON kd."id" = kc."documentId"
WHERE ki."id" = kc."knowledgeItemId";

CREATE INDEX "KnowledgeChunk_scopeLevel_cityCode_idx" ON "KnowledgeChunk"("scopeLevel", "cityCode");
CREATE INDEX "KnowledgeChunk_overrideScope_idx" ON "KnowledgeChunk"("overrideScope");
