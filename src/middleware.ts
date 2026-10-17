import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/admin", "/employee"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!PROTECTED.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return NextResponse.next();
  }

  // Cek cepat: cookie sesi ada atau tidak. Otorisasi sebenarnya tetap di server (requireAdmin/requireEmployee).
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/employee/:path*"],
};
