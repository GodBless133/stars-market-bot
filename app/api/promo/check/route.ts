import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

// GET /api/promo/check?code=WELCOME10
// Public — anyone can check if a promo code is valid.
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")?.trim().toUpperCase()
  if (!code) {
    return NextResponse.json({ valid: false, error: "Укажите промокод" }, { status: 400 })
  }

  try {
    const promo = await db.promoCode.findUnique({ where: { code } })
    if (!promo || !promo.active) {
      return NextResponse.json({ valid: false, error: "Промокод не найден" })
    }
    if (promo.usesCount >= promo.maxUses) {
      return NextResponse.json({ valid: false, error: "Промокод исчерпан" })
    }
    if (promo.expiresAt && promo.expiresAt < new Date()) {
      return NextResponse.json({ valid: false, error: "Срок действия истёк" })
    }

    return NextResponse.json({
      valid: true,
      type: promo.type,
      value: promo.value,
      remaining: promo.maxUses - promo.usesCount,
    })
  } catch (e: any) {
    console.error("[promo/check] error:", e?.message || e)
    return NextResponse.json({ valid: false, error: "Ошибка проверки" }, { status: 500 })
  }
}
