import { createServer, Server } from "node:http";

import type { UserRole } from "@prisma/client";
import { WebSocketServer, WebSocket } from "ws";

import { prisma } from "@/lib/db";
import { env } from "@/lib/env";

type ClientMeta = {
  socket: WebSocket;
  userId: string;
  role: UserRole;
};

type TicketNotificationEvent = {
  type: "ticket_created" | "ticket_assigned_l1" | "ticket_escalated_l2" | "ticket_replied" | "ticket_closed";
  title: string;
  message: string;
  ticketId: string;
  ticketNo: string;
  targetRoles?: UserRole[];
  targetUserIds?: string[];
  pendingCounts?: {
    human_l1: number;
    human_l2: number;
  };
  createdAt: string;
};

declare global {
  var __pharmacyNotificationServer:
    | {
        server: Server;
        wss: WebSocketServer;
        clients: Set<ClientMeta>;
      }
    | undefined;
}

function serializeEvent(event: TicketNotificationEvent) {
  return JSON.stringify(event);
}

export async function ensureNotificationServer() {
  if (globalThis.__pharmacyNotificationServer) {
    return globalThis.__pharmacyNotificationServer;
  }

  const clients = new Set<ClientMeta>();
  const server = createServer();
  const wss = new WebSocketServer({ server });

  wss.on("connection", async (socket, request) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    const token = url.searchParams.get("token");
    if (!token) {
      socket.close(1008, "missing token");
      return;
    }

    const session = await prisma.session.findUnique({
      where: { token },
      include: { user: true }
    });
    if (!session || session.expiresAt.getTime() < Date.now()) {
      socket.close(1008, "invalid token");
      return;
    }

    const meta: ClientMeta = {
      socket,
      userId: session.userId,
      role: session.user.role
    };
    clients.add(meta);

    socket.on("close", () => {
      clients.delete(meta);
    });

    try {
      const counts = await getPendingTicketCounts();
      socket.send(
        JSON.stringify({
          type: "snapshot",
          pendingCounts: counts
        })
      );
    } catch {
      // 忽略初始化快照失败，避免阻断连接。
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(env.NOTIFICATION_WS_PORT, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  globalThis.__pharmacyNotificationServer = { server, wss, clients };
  return globalThis.__pharmacyNotificationServer;
}

export async function getPendingTicketCounts() {
  const [human_l1, human_l2] = await Promise.all([
    prisma.ticket.count({
      where: {
        status: "pending_l1",
        currentAssigneeRole: "human_l1"
      }
    }),
    prisma.ticket.count({
      where: {
        status: "pending_l2",
        currentAssigneeRole: "human_l2"
      }
    })
  ]);

  return { human_l1, human_l2 };
}

export async function broadcastTicketNotification(event: Omit<TicketNotificationEvent, "pendingCounts" | "createdAt">) {
  const runtime = await ensureNotificationServer();
  const pendingCounts = await getPendingTicketCounts();
  const payload: TicketNotificationEvent = {
    ...event,
    pendingCounts,
    createdAt: new Date().toISOString()
  };
  const serialized = serializeEvent(payload);

  for (const client of runtime.clients) {
    if (event.targetUserIds?.length && !event.targetUserIds.includes(client.userId)) {
      if (!event.targetRoles?.includes(client.role)) {
        continue;
      }
    }
    if (!event.targetUserIds?.length && event.targetRoles?.length && !event.targetRoles.includes(client.role)) {
      continue;
    }
    if (client.socket.readyState === WebSocket.OPEN) {
      client.socket.send(serialized);
    }
  }
}
