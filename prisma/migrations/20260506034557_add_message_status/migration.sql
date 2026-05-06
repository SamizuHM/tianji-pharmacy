-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('streaming', 'completed', 'failed');

-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "status" "MessageStatus" NOT NULL DEFAULT 'completed';
