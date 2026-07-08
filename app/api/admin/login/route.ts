import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

// FIX 3: in-memory IP rate limiter — 5 attempts / 5 min per IP.
// (Single-process limit; sufficient for a single-instance admin route.)
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 5;
const loginAttempts = new Map<string, { count: number; firstAt: number }>();

export async function POST(req: NextRequest) {
  try {
    if (!ADMIN_PASSWORD || !ADMIN_TOKEN) {
      return NextResponse.json(
        { error: "Admin auth not configured on server" },
        { status: 500 }
      );
    }

    // FIX 3: IP rate-limit. Trigger 429 once the IP exceeds 5 attempts in 5 min.
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const now = Date.now();
    const rec = loginAttempts.get(ip);
    if (
      rec &&
      now - rec.firstAt < RATE_LIMIT_WINDOW_MS &&
      rec.count >= RATE_LIMIT_MAX
    ) {
      return NextResponse.json(
        { error: "Слишком много попыток. Подождите 5 минут." },
        { status: 429 }
      );
    }

    const { password } = await req.json();

    // FIX 3: constant-time password comparison.
    const a = Buffer.from(String(password));
    const b = Buffer.from(ADMIN_PASSWORD);
    const passwordOk =
      a.length === b.length &&
      (a.length === 0 ? false : crypto.timingSafeEqual(a, b));

    if (!passwordOk) {
      const cur = loginAttempts.get(ip) || { count: 0, firstAt: now };
      // Reset window if previous window has expired.
      if (now - cur.firstAt > RATE_LIMIT_WINDOW_MS) {
        cur.firstAt = now;
        cur.count = 0;
      }
      cur.count += 1;
      loginAttempts.set(ip, cur);
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }

    // Success: clear attempts for this IP.
    loginAttempts.delete(ip);

    const res = NextResponse.json({ ok: true });
    res.cookies.set("admin_session", ADMIN_TOKEN, {
      httpOnly: true,
      sameSite: "strict",
      // FIX 3: only transmit the cookie over HTTPS in production.
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
}
