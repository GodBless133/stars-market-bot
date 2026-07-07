import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // Protect all /api/admin/* EXCEPT /api/admin/login
  if (pathname.startsWith("/api/admin/") && pathname !== "/api/admin/login") {
    const cookie = req.cookies.get("admin_session")?.value;
    if (!ADMIN_TOKEN || cookie !== ADMIN_TOKEN) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/admin/:path*"],
};
