import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import {
  canAccessTicket,
  generateTicketKnowledgeDraft,
  getTicketDetail,
} from "@/lib/services/tickets";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || (user.role !== "department" && user.role !== "admin")) {
    return NextResponse.json({ error: "只有部门人员或管理员可以生成待入库内容" }, { status: 403 });
  }

  const { id } = await context.params;
  const ticket = await getTicketDetail(id);
  if (!ticket) {
    return NextResponse.json({ error: "工单不存在" }, { status: 404 });
  }
  if (
    !canAccessTicket({
      role: user.role,
      userId: user.id,
      userDepartmentName: user.department?.name ?? null,
      userRegionId: user.regionId ?? null,
      ticket,
    })
  ) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const body = (await request.json()) as { selectedMaterialIds?: string[] };
  if (!body.selectedMaterialIds?.length) {
    return NextResponse.json({ error: "请选择有效对话内容" }, { status: 400 });
  }

  try {
    const draft = await generateTicketKnowledgeDraft({
      ticketId: id,
      generatedByUserId: user.id,
      selectedMaterialIds: body.selectedMaterialIds,
    });
    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "生成失败" },
      { status: 400 }
    );
  }
}
