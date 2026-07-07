import { NextResponse } from "next/server"
import { db } from "@/lib/db"
export const dynamic = "force-dynamic"

export async function GET() {
  // Получить первый аккаунт с сессией для теста
  const account = await db.stockItem.findFirst({
    where: { productId: "cmqyh5jkc000fqk0pt8szw2kb", status: "available", sessionFile: { not: null } },
    select: { id: true, phone: true, sessionFile: true },
  })
  
  if (!account || !account.sessionFile) {
    return NextResponse.json({ error: "No account with session" })
  }
  
  // Тестируем Python MTProto напрямую
  try {
    const res = await fetch("https://mtproto-api-production.up.railway.app/getcode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session: account.sessionFile,
        phone: account.phone,
      }),
    })
    const data = await res.json()
    return NextResponse.json({
      account: { id: account.id, phone: account.phone, sessionLen: account.sessionFile.length },
      mtprotoResponse: data,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message })
  }
}

export async function POST() {
  // Сбросить все проданные аккаунты
  const reset = await db.stockItem.updateMany({
    where: { productId: "cmqyh5jkc000fqk0pt8szw2kb", status: { in: ["sold", "reserved"] } },
    data: { status: "available", soldAt: null },
  })
  const available = await db.stockItem.count({ where: { productId: "cmqyh5jkc000fqk0pt8szw2kb", status: "available" } })
  return NextResponse.json({ ok: true, reset: reset.count, available })
}
