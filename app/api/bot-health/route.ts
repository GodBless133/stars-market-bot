import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Server-side proxy to the tg-bot mini-service on port 3004.
// Works regardless of how the site is accessed (direct :3000 or via Caddy :81).
export async function GET() {
  try {
    const res = await fetch("http://localhost:3004/health", {
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) {
      return NextResponse.json({ ok: false, bot: "down", status: res.status })
    }
    const data = await res.json()
    return NextResponse.json(data)
  } catch {
    return NextResponse.json({ ok: false, bot: "down" })
  }
}
