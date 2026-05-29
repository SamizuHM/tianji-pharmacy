import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export async function GET() {
  const users = await prisma.user.findMany({
    where: { enabled: true },
    select: {
      username: true,
      displayName: true,
      role: true,
      department: { select: { name: true } },
    },
    orderBy: [{ role: "asc" }, { username: "asc" }],
  });

  return NextResponse.json(
    users.map((u) => ({
      username: u.username,
      displayName: u.displayName,
      role: u.role,
      departmentName: u.department?.name ?? null,
    }))
  );
}
