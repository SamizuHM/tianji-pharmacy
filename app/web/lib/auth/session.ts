import crypto from "node:crypto";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";

import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

const COOKIE_NAME = "pharmacy_demo_session";

export const SESSION_COOKIE_NAME = COOKIE_NAME;

export async function createSession(userId: string) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt
    }
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    expires: expiresAt
  });

  return token;
}

export async function destroySession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (token) {
    await prisma.session.deleteMany({ where: { token } });
  }

  cookieStore.delete(COOKIE_NAME);
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE_NAME)?.value;

  if (!token) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { token },
    include: { user: { include: { department: true } } }
  });

  if (!session || session.expiresAt.getTime() < Date.now()) {
    try {
      cookieStore.delete(COOKIE_NAME);
    } catch {
      // Server Component 中 cookies() 是只读的，忽略删除失败
    }
    if (session) {
      await prisma.session.delete({ where: { token } });
    }
    return null;
  }

  return session.user;
}

export async function getSessionToken() {
  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export async function requireUser(roles?: UserRole[]) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (roles && !roles.includes(user.role)) {
    redirect(roleHome(user.role));
  }

  return user;
}

export function roleHome(role: UserRole) {
  switch (role) {
    case "staff":
      return "/staff/chat";
    case "agent":
      return "/agent/tickets";
    default:
      return "/login";
  }
}
