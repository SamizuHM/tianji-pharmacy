import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const departments = await prisma.department.findMany({
    include: {
      users: {
        select: { id: true, displayName: true },
        orderBy: { displayName: "asc" }
      }
    },
    orderBy: { name: "asc" }
  });

  return NextResponse.json({ departments });
}
