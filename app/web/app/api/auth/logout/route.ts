import { NextResponse } from "next/server";

import { destroySession } from "@/lib/auth/session";

export async function POST(request: Request) {
  await destroySession();
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedHost) {
    const proto = forwardedProto || "https";
    return NextResponse.redirect(`${proto}://${forwardedHost}/login`);
  }

  return NextResponse.redirect(new URL("/login", request.url));
}
