import { NextRequest, NextResponse } from "next/server";

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (!ADMIN_PASSWORD || !ADMIN_TOKEN) {
      return NextResponse.json({ error: "Admin auth not configured on server" }, { status: 500 });
    }
    if (password !== ADMIN_PASSWORD) {
      return NextResponse.json({ error: "Неверный пароль" }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set("admin_session", ADMIN_TOKEN, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return res;
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
}
