ALTER TABLE "KnowledgeChunk" ADD COLUMN "scopeLevel" "KnowledgeScopeLevel" NOT NULL DEFAULT 'national';
ALTER TABLE "KnowledgeChunk" ADD COLUMN "cityCode" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "cityName" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "overrideScope" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "bm25SearchText" TEXT;
ALTER TABLE "KnowledgeChunk" ADD COLUMN "hypotheticalQuestionsJson" TEXT;

UPDATE "KnowledgeChunk" AS kc
SET
  "scopeLevel" = COALESCE(
    (SELECT kd."scopeLevel" FROM "KnowledgeDocument" kd WHERE kd."id" = kc."documentId"),
    'national'
  ),
  "cityCode" = (SELECT kd."cityCode" FROM "KnowledgeDocument" kd WHERE kd."id" = kc."documentId"),
  "cityName" = (SELECT kd."cityName" FROM "KnowledgeDocument" kd WHERE kd."id" = kc."documentId"),
  "bm25SearchText" = CONCAT_WS(
    E'\n',
    kc."chunkText",
    (SELECT ki."question" FROM "KnowledgeItem" ki WHERE ki."id" = kc."knowledgeItemId"),
    (SELECT ki."answer" FROM "KnowledgeItem" ki WHERE ki."id" = kc."knowledgeItemId"),
    (SELECT ki."categoryL1" FROM "KnowledgeItem" ki WHERE ki."id" = kc."knowledgeItemId"),
    (SELECT ki."categoryL2" FROM "KnowledgeItem" ki WHERE ki."id" = kc."knowledgeItemId"),
    kc."sourceFile"
  );

CREATE INDEX "KnowledgeChunk_scopeLevel_cityCode_idx" ON "KnowledgeChunk"("scopeLevel", "cityCode");
CREATE INDEX "KnowledgeChunk_overrideScope_idx" ON "KnowledgeChunk"("overrideScope");
