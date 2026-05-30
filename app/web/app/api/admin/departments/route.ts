import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const departments = await prisma.department.findMany({
    include: { region: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ departments });
}
