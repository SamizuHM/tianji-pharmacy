-- Rename the old customer-service role into department staff and add admin.
ALTER TYPE "UserRole" RENAME VALUE 'agent' TO 'department';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'admin';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "enabled" BOOLEAN NOT NULL DEFAULT TRUE;

-- Seed the fallback department at migration time so existing deployments can route safely.
INSERT INTO "Department" ("id", "name", "description", "createdAt")
VALUES ('dept_other_department', '其他部门', '无法明确归属、跨部门或兜底处理', NOW())
ON CONFLICT ("name") DO NOTHING;
