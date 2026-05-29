ALTER TABLE "KnowledgeChunk" ADD COLUMN "bm25DocLength" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "KnowledgeBm25Term" (
  "id" TEXT NOT NULL,
  "chunkId" TEXT NOT NULL,
  "term" TEXT NOT NULL,
  "termFrequency" INTEGER NOT NULL,
  "docLength" INTEGER NOT NULL,
  "scopeLevel" "KnowledgeScopeLevel" NOT NULL DEFAULT 'common',
  "cityName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "KnowledgeBm25Term_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KnowledgeBm25Term_chunkId_term_key" ON "KnowledgeBm25Term"("chunkId", "term");
CREATE INDEX "KnowledgeBm25Term_term_scopeLevel_cityName_idx" ON "KnowledgeBm25Term"("term", "scopeLevel", "cityName");
CREATE INDEX "KnowledgeBm25Term_chunkId_idx" ON "KnowledgeBm25Term"("chunkId");

ALTER TABLE "KnowledgeBm25Term"
  ADD CONSTRAINT "KnowledgeBm25Term_chunkId_fkey"
  FOREIGN KEY ("chunkId") REFERENCES "KnowledgeChunk"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
