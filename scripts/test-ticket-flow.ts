import "dotenv/config";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL ?? `file:${path.resolve(process.cwd(), "prisma", "dev.db")}`
    }
  }
});

const BASE = "http://127.0.0.1:3000";

async function login(username: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "demo123" }),
    redirect: "manual"
  });
  const cookie = res.headers.get("set-cookie");
  if (!cookie) throw new Error(`Login failed for ${username}`);
  return cookie.split(";")[0];
}

async function api(path: string, cookie: string, options?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      cookie,
      ...options?.headers
    }
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function main() {
  console.log("=== 工单系统端到端测试 ===\n");

  // 1. 获取用户
  const staffUser = await prisma.user.findUnique({ where: { username: "药店工作人员" } });
  const l1User1 = await prisma.user.findUnique({ where: { username: "人工处理1" } });
  const l1User2 = await prisma.user.findUnique({ where: { username: "人工处理2" } });
  const deptUser = await prisma.user.findUnique({ where: { username: "营运-张伟" } });

  if (!staffUser || !l1User1 || !l1User2 || !deptUser) {
    console.error("缺少测试用户");
    return;
  }

  console.log(`staff: ${staffUser.displayName} (${staffUser.id})`);
  console.log(`L1-1: ${l1User1.displayName} (${l1User1.id})`);
  console.log(`L1-2: ${l1User2.displayName} (${l1User2.id})`);
  console.log(`营运-张伟: ${deptUser.displayName} (${deptUser.id})\n`);

  // 2. 登录所有用户
  const staffCookie = await login("药店工作人员");
  const l1Cookie1 = await login("人工处理1");
  const l1Cookie2 = await login("人工处理2");
  const deptCookie = await login("营运-张伟");
  console.log("✓ 所有用户登录成功\n");

  // 3. 创建会话和消息
  let conversation = await prisma.conversation.findFirst({ where: { userId: staffUser.id } });
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { title: "测试会话", userId: staffUser.id }
    });
  }

  await prisma.chatMessage.createMany({
    data: [
      { conversationId: conversation.id, role: "user", sourceType: "manual", contentText: "医保刷卡失败了，显示错误代码E001，顾客很着急" },
      { conversationId: conversation.id, role: "assistant", sourceType: "kb", contentText: "错误代码E001通常表示医保网络连接超时。请检查：1. 网络连接是否正常 2. 医保读卡器是否正确连接" }
    ]
  });
  console.log("✓ 测试会话和消息创建成功\n");

  // 4. 创建工单
  console.log("--- 测试1: 创建工单 ---");
  const createRes = await api("/api/tickets", staffCookie, {
    method: "POST",
    body: JSON.stringify({ conversationId: conversation.id })
  });
  console.log(`状态: ${createRes.status}`);
  if (createRes.status !== 200) {
    console.error("创建工单失败:", createRes.data);
    return;
  }
  const ticketId = createRes.data.ticket.id;
  const ticketNo = createRes.data.ticket.ticketNo;
  console.log(`工单创建成功: ${ticketNo} (ID: ${ticketId})`);
  console.log(`状态: ${createRes.data.ticket.status}`);
  console.log();

  // 5. 查看待认领列表
  console.log("--- 测试2: L1 查看待认领列表 ---");
  const listRes = await api("/api/tickets?statusGroup=pending", l1Cookie1);
  console.log(`状态: ${listRes.status}`);
  console.log(`待认领数量: ${listRes.data.total}`);
  console.log();

  // 6. L1-1 认领工单
  console.log("--- 测试3: L1-1 认领工单 ---");
  const claimRes = await api(`/api/tickets/${ticketId}/claim`, l1Cookie1, { method: "POST" });
  console.log(`状态: ${claimRes.status}`);
  console.log(`工单状态: ${claimRes.data.ticket?.status}`);
  console.log();

  // 7. L1-2 尝试认领同一工单（应失败）
  console.log("--- 测试4: L1-2 并发认领（应返回409） ---");
  const claimRes2 = await api(`/api/tickets/${ticketId}/claim`, l1Cookie2, { method: "POST" });
  console.log(`状态: ${claimRes2.status} (期望 409)`);
  console.log(`错误: ${claimRes2.data.error}`);
  console.log();

  // 8. L1-1 回复工单
  console.log("--- 测试5: L1-1 回复工单 ---");
  const replyRes = await api(`/api/tickets/${ticketId}/reply`, l1Cookie1, {
    method: "POST",
    body: JSON.stringify({ content: "已排查，医保网络正常，建议重启读卡器后重试" })
  });
  console.log(`状态: ${replyRes.status}`);
  console.log();

  // 9. L1-1 升级到营运部
  console.log("--- 测试6: L1-1 升级到营运部 ---");
  const escalateRes = await api(`/api/tickets/${ticketId}/escalate`, l1Cookie1, {
    method: "POST",
    body: JSON.stringify({ targetDept: "营运部" })
  });
  console.log(`状态: ${escalateRes.status}`);
  console.log(`工单状态: ${escalateRes.data.ticket?.status}`);
  console.log(`升级目标: ${escalateRes.data.ticket?.escalatedToDept}`);
  console.log();

  // 10. 营运部用户认领升级后的工单
  console.log("--- 测试7: 营运部用户认领升级工单 ---");
  const claimDeptRes = await api(`/api/tickets/${ticketId}/claim`, deptCookie, { method: "POST" });
  console.log(`状态: ${claimDeptRes.status}`);
  console.log(`工单状态: ${claimDeptRes.data.ticket?.status}`);
  console.log();

  // 11. 营运部用户回复
  console.log("--- 测试8: 营运部用户回复 ---");
  const replyDeptRes = await api(`/api/tickets/${ticketId}/reply`, deptCookie, {
    method: "POST",
    body: JSON.stringify({ content: "已联系医保中心，确认是系统升级导致的临时故障，建议等待30分钟后重试" })
  });
  console.log(`状态: ${replyDeptRes.status}`);
  console.log();

  // 12. 营运部用户提交解决方案
  console.log("--- 测试9: 提交解决方案 ---");
  const submitRes = await api(`/api/tickets/${ticketId}/submit-resolution`, deptCookie, {
    method: "POST",
    body: JSON.stringify({ resolutionText: "问题原因：医保系统升级导致临时故障。解决方案：等待30分钟后重试，若仍失败请联系医保中心技术支持。" })
  });
  console.log(`状态: ${submitRes.status}`);
  console.log();

  // 13. L1-1 尝试关闭（应失败，只有staff能关）
  console.log("--- 测试10: L1-1 尝试关闭（应返回403） ---");
  const closeFailRes = await api(`/api/tickets/${ticketId}/close`, l1Cookie1, {
    method: "POST",
    body: JSON.stringify({ resolutionText: "测试" })
  });
  console.log(`状态: ${closeFailRes.status} (期望 403)`);
  console.log();

  // 14. Staff 关闭工单
  console.log("--- 测试11: Staff 关闭工单 ---");
  const closeRes = await api(`/api/tickets/${ticketId}/close`, staffCookie, {
    method: "POST",
    body: JSON.stringify({})
  });
  console.log(`状态: ${closeRes.status}`);
  console.log(`工单状态: ${closeRes.data.ticket?.status}`);
  console.log();

  // 15. 查看工单详情
  console.log("--- 测试12: 查看最终工单详情 ---");
  const detailRes = await api(`/api/tickets/${ticketId}`, staffCookie);
  console.log(`状态: ${detailRes.status}`);
  const ticket = detailRes.data.ticket;
  console.log(`工单编号: ${ticket.ticketNo}`);
  console.log(`状态: ${ticket.status}`);
  console.log(`认领人: ${ticket.claimedBy?.displayName || "无"}`);
  console.log(`升级目标: ${ticket.escalatedToDept || "无"}`);
  console.log(`解决方案提交人: ${ticket.resolutionSubmittedBy?.displayName || "无"}`);
  console.log(`关闭人: ${ticket.closedBy?.displayName || "无"}`);
  console.log(`消息数量: ${ticket.messages?.length}`);
  console.log();

  // 16. 查看部门列表
  console.log("--- 测试13: 部门列表 ---");
  const deptRes = await api("/api/departments", staffCookie);
  console.log(`状态: ${deptRes.status}`);
  console.log(`部门数量: ${deptRes.data.departments?.length}`);
  deptRes.data.departments?.forEach((d: { name: string; users: unknown[] }) => {
    console.log(`  ${d.name}: ${d.users.length} 人`);
  });
  console.log();

  console.log("=== 测试完成 ===");
}

main()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
