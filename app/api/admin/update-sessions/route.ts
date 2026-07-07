import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
export const dynamic = "force-dynamic"
export const maxDuration = 60

export async function POST(req: NextRequest) {
  const { updates } = await req.json()
  let updated = 0
  for (const u of updates) {
    // Нормализуем телефон — убираем двойные +
    const phone = u.phone.replace("++", "+")
    const result = await db.stockItem.updateMany({
      where: { phone },
      data: { sessionFile: u.session },
    })
    updated += result.count
  }
  return NextResponse.json({ ok: true, updated })
}
