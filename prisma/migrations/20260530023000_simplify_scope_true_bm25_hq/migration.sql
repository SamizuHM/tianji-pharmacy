-- Simplify knowledge scope to common/cityName and remove document-bound answer policy.
DROP TABLE IF EXISTS "AnswerPolicyRule";

ALTER TABLE "KnowledgeDocument" DROP COLUMN IF EXISTS "answerPolicy";
ALTER TABLE "KnowledgeDocument" DROP COLUMN IF EXISTS "provinceCode";
ALTER TABLE "KnowledgeDocument" DROP COLUMN IF EXISTS "provinceName";
ALTER TABLE "KnowledgeDocument" DROP COLUMN IF EXISTS "cityCode";
ALTER TABLE "KnowledgeDocument" DROP COLUMN IF EXISTS "districtCode";
ALTER TABLE "KnowledgeDocument" DROP COLUMN IF EXISTS "districtName";
ALTER TABLE "KnowledgeDocument" DROP COLUMN IF EXISTS "storeId";
ALTER TABLE "KnowledgeChunk" DROP COLUMN IF EXISTS "cityCode";
ALTER TABLE "Store" DROP COLUMN IF EXISTS "cityCode";

ALTER TABLE "KnowledgeDocument" ALTER COLUMN "scopeLevel" DROP DEFAULT;
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "scopeLevel" DROP DEFAULT;
CREATE TYPE "KnowledgeScopeLevel_new" AS ENUM ('common', 'city');
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "scopeLevel" TYPE "KnowledgeScopeLevel_new" USING CASE WHEN "scopeLevel"::text = 'city' THEN 'city'::"KnowledgeScopeLevel_new" ELSE 'common'::"KnowledgeScopeLevel_new" END;
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "scopeLevel" TYPE "KnowledgeScopeLevel_new" USING CASE WHEN "scopeLevel"::text = 'city' THEN 'city'::"KnowledgeScopeLevel_new" ELSE 'common'::"KnowledgeScopeLevel_new" END;
DROP TYPE IF EXISTS "KnowledgeScopeLevel";
ALTER TYPE "KnowledgeScopeLevel_new" RENAME TO "KnowledgeScopeLevel";
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "scopeLevel" SET DEFAULT 'common';
ALTER TABLE "KnowledgeChunk" ALTER COLUMN "scopeLevel" SET DEFAULT 'common';

DROP TYPE IF EXISTS "KnowledgeAnswerPolicy";

DROP INDEX IF EXISTS "KnowledgeDocument_scopeLevel_provinceCode_cityCode_district_idx";
DROP INDEX IF EXISTS "KnowledgeChunk_scopeLevel_cityCode_idx";
DROP INDEX IF EXISTS "Store_provinceCode_cityCode_districtCode_idx";
CREATE INDEX IF NOT EXISTS "KnowledgeDocument_scopeLevel_cityName_idx" ON "KnowledgeDocument"("scopeLevel", "cityName");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_scopeLevel_cityName_idx" ON "KnowledgeChunk"("scopeLevel", "cityName");
CREATE INDEX IF NOT EXISTS "Store_cityName_idx" ON "Store"("cityName");
