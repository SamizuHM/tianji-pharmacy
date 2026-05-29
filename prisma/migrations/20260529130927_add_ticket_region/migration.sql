-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "regionId" TEXT;

-- CreateIndex
CREATE INDEX "Ticket_regionId_idx" ON "Ticket"("regionId");

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;
