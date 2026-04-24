import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPrefixes = ["/staff", "/l1", "/l2", "/admin"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtected = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));
  const hasSession = request.cookies.has("pharmacy_demo_session");

  if (isProtected && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (pathname === "/" && hasSession) {
    return NextResponse.redirect(new URL("/staff/chat", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/staff/:path*", "/l1/:path*", "/l2/:path*", "/admin/:path*"]
};

