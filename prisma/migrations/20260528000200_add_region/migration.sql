-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- AlterTable: Department - add regionId (nullable first for data migration)
ALTER TABLE "Department" ADD COLUMN "regionId" TEXT;

-- AlterTable: User - add regionId
ALTER TABLE "User" ADD COLUMN "regionId" TEXT;

-- Drop old unique index on Department.name
DROP INDEX "Department_name_key";

-- AddForeignKey (Department -> Region)
ALTER TABLE "Department" ADD CONSTRAINT "Department_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey (User -> Region)
ALTER TABLE "User" ADD CONSTRAINT "User_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- NOTE: After running this migration, execute the seed script to:
-- 1. Create Region records
-- 2. Create Department records per region (with regionId set)
-- Then run the following to make regionId required:
-- ALTER TABLE "Department" ALTER COLUMN "regionId" SET NOT NULL;
-- CREATE UNIQUE INDEX "Department_name_regionId_key" ON "Department"("name", "regionId");
