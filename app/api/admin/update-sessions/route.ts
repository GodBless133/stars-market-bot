import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
export const dynamic = "force-dynamic"
export const maxDuration = 60

interface SessionUpdate {
  phone: string
  session: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { updates } = body as { updates?: unknown }

    // FIX 7: validate input shape
    if (!Array.isArray(updates)) {
      return NextResponse.json(
        { error: "updates должен быть массивом" },
        { status: 400 }
      )
    }
    for (const u of updates) {
      if (
        !u ||
        typeof (u as any).phone !== "string" ||
        typeof (u as any).session !== "string"
      ) {
        return NextResponse.json(
          { error: "Каждый update должен содержать phone:string и session:string" },
          { status: 400 }
        )
      }
    }

    let updated = 0
    for (const u of updates as SessionUpdate[]) {
      // Нормализуем телефон — убираем двойные +
      const phone = u.phone.replace("++", "+")
      const result = await db.stockItem.updateMany({
        where: { phone },
        data: { sessionFile: u.session },
      })
      updated += result.count
    }
    return NextResponse.json({ ok: true, updated })
  } catch (e: any) {
    console.error("[admin/update-sessions] failed:", e)
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    )
  }
}
