import crypto from "node:crypto";

import type { UserRole } from "@prisma/client";

import { prisma } from "@/lib/db";

type PendingCounts = {
  human_l1: number;
  human_l2: number;
};

type TicketNotificationEvent = {
  type: "ticket_created" | "ticket_assigned_l1" | "ticket_escalated_l2" | "ticket_replied" | "ticket_closed";
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

export async function createNotificationStream(input: { userId: string; role: UserRole }) {
  const clientId = crypto.randomUUID();
  const clientStore = getClientStore();
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const client: ClientMeta = {
        id: clientId,
        userId: input.userId,
        role: input.role,
        controller
      };
      clientStore.set(clientId, client);

      const pendingCounts = await getPendingTicketCounts();
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

  const pendingCounts = await getPendingTicketCounts();
  const payload: TicketNotificationEvent = {
    ...event,
    pendingCounts,
    createdAt: new Date().toISOString()
  };

  for (const client of clientStore.values()) {
    if (event.targetUserIds?.length && !event.targetUserIds.includes(client.userId)) {
      if (!event.targetRoles?.includes(client.role)) {
        continue;
      }
    }
    if (!event.targetUserIds?.length && event.targetRoles?.length && !event.targetRoles.includes(client.role)) {
      continue;
    }
    pushEvent(client, "ticket", payload);
  }
}
