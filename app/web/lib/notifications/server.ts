import crypto from "node:crypto";

import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";

type PendingCounts = {
  pendingClaim: number;
  escalated: number;
};

type TicketNotificationEvent = {
  type: "ticket_created" | "ticket_claimed" | "ticket_escalated" | "ticket_replied" | "ticket_closed" | "ticket_resolution_submitted";
  title: string;
  message: string;
  ticketId: string;
  ticketNo: string;
  targetRoles?: UserRole[];
  targetUserIds?: string[];
  pendingCounts?: PendingCounts;
  createdAt: string;
};

type StreamEvent =
  | {
      type: "snapshot" | "ping";
      pendingCounts?: PendingCounts;
      createdAt: string;
    }
  | TicketNotificationEvent;

type ClientMeta = {
  id: string;
  userId: string;
  role: UserRole;
  userDepartmentName?: string | null;
  controller: ReadableStreamDefaultController<Uint8Array>;
};

declare global {
  var __pharmacyNotificationClients: Map<string, ClientMeta> | undefined;
}

const encoder = new TextEncoder();

function getClientStore() {
  if (!globalThis.__pharmacyNotificationClients) {
    globalThis.__pharmacyNotificationClients = new Map();
  }
  return globalThis.__pharmacyNotificationClients;
}

function serializeSse(event: string, data: StreamEvent) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function pushEvent(client: ClientMeta, event: string, data: StreamEvent) {
  try {
    client.controller.enqueue(serializeSse(event, data));
    return true;
  } catch {
    getClientStore().delete(client.id);
    return false;
  }
}

export async function getPendingTicketCounts(input?: {
  role?: UserRole;
  userId?: string;
  userDepartmentName?: string | null;
}) {
  const pendingClaimWhere =
    input?.role === "agent" && input.userDepartmentName
      ? { id: "__never__" }
      : { status: "pending_claim" as const };
  const escalatedWhere =
    input?.role === "agent" && input.userDepartmentName
      ? {
          status: "escalated" as const,
          OR: [
            { escalatedToDept: input.userDepartmentName },
            ...(input.userId ? [{ escalatedToUserId: input.userId }] : [])
          ]
        }
      : { status: "escalated" as const };

  const [pendingClaim, escalated] = await Promise.all([
    prisma.ticket.count({
      where: pendingClaimWhere
    }),
    prisma.ticket.count({
      where: escalatedWhere
    })
  ]);

  return { pendingClaim, escalated };
}

export async function createNotificationStream(input: { userId: string; role: UserRole; userDepartmentName?: string | null }) {
  const clientId = crypto.randomUUID();
  const clientStore = getClientStore();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const client: ClientMeta = {
        id: clientId,
        userId: input.userId,
        role: input.role,
        userDepartmentName: input.userDepartmentName,
        controller
      };
      clientStore.set(clientId, client);

      const pendingCounts = await getPendingTicketCounts(input);
      pushEvent(client, "snapshot", {
        type: "snapshot",
        pendingCounts,
        createdAt: new Date().toISOString()
      });

      heartbeat = setInterval(() => {
        const activeClient = clientStore.get(clientId);
        if (!activeClient) {
          if (heartbeat) {
            clearInterval(heartbeat);
          }
          return;
        }
        pushEvent(activeClient, "ping", {
          type: "ping",
          createdAt: new Date().toISOString()
        });
      }, 20000);
    },
    cancel() {
      clientStore.delete(clientId);
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    }
  });

  return stream;
}

export async function broadcastTicketNotification(event: Omit<TicketNotificationEvent, "pendingCounts" | "createdAt">) {
  const clientStore = getClientStore();
  if (!clientStore.size) {
    return;
  }

  for (const client of clientStore.values()) {
    if (event.targetUserIds?.length && !event.targetUserIds.includes(client.userId)) {
      if (!event.targetRoles?.includes(client.role)) {
        continue;
      }
    }
    if (!event.targetUserIds?.length && event.targetRoles?.length && !event.targetRoles.includes(client.role)) {
      continue;
    }
    const pendingCounts = await getPendingTicketCounts({
      role: client.role,
      userId: client.userId,
      userDepartmentName: client.userDepartmentName
    });
    const payload: TicketNotificationEvent = {
      ...event,
      pendingCounts,
      createdAt: new Date().toISOString()
    };
    pushEvent(client, "ticket", payload);
  }
}
