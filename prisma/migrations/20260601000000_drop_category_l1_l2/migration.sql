-- DropIndex
DROP INDEX "KnowledgeItem_categoryL1_categoryL2_idx";

-- AlterTable
ALTER TABLE "KnowledgeItem" DROP COLUMN "categoryL1",
DROP COLUMN "categoryL2";

-- AlterTable
ALTER TABLE "TicketKnowledgeDraft" DROP COLUMN "categoryL1",
DROP COLUMN "categoryL2";

-- AlterTable
ALTER TABLE "KnowledgeDocument" ALTER COLUMN "businessCategory" DROP NOT NULL,
ALTER COLUMN "businessCategory" DROP DEFAULT;
