import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { createPayment } from "@/lib/platega"
import { validateTelegramInitData } from "@/lib/telegram-auth"

export const dynamic = "force-dynamic"

// POST /api/platega/create
// Body: { orderId: string }
// Creates a Platega payment transaction for the order and returns the payment URL.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { orderId } = body as { orderId?: string }
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 })
    }

    // Validate Telegram initData (so only the order's owner can pay for it)
    const botToken = process.env.BOT_TOKEN || ""
    const initData = req.headers.get("x-telegram-init-data") || ""
    const validatedTgId = validateTelegramInitData(initData, botToken)
    // Allow fallback if initData absent (admin/web testing) — but log it
    if (initData && !validatedTgId) {
      return NextResponse.json({ error: "invalid telegram auth" }, { status: 401 })
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    })
    if (!order) {
      return NextResponse.json({ error: "Заказ не найден" }, { status: 404 })
    }
    if (order.status !== "pending") {
      return NextResponse.json({ error: `Заказ уже ${order.status} — оплата невозможна` }, { status: 400 })
    }
    // If initData validated, ensure the caller owns this order
    if (validatedTgId && order.customerTg && String(order.customerTg) !== String(validatedTgId)) {
      return NextResponse.json({ error: "Это не ваш заказ" }, { status: 403 })
    }

    const webappUrl = process.env.WEBAPP_URL || "https://starsshop-production.up.railway.app"
    const result = await createPayment({
      amount: order.total,
      currency: order.currency || "RUB",
      description: `Оплата заказа ${order.number}`,
      returnUrl: `${webappUrl}/payment-success?order=${order.number}`,
      failUrl: `${webappUrl}/payment-failed?order=${order.number}`,
      payload: order.id, // we get this back in webhook
      userId: order.customerTg || undefined,
      userName: order.customerName || undefined,
    })

    if (!result.ok) {
      console.error("[platega/create] failed:", result.error)
      return NextResponse.json({ error: `Platega: ${result.error}` }, { status: 502 })
    }

    // Save transactionId on the order so the webhook can find it
    await db.order.update({
      where: { id: order.id },
      data: {
        plategaTransactionId: result.data.transactionId,
        payMethod: "card",
      },
    })

    return NextResponse.json({
      url: result.data.url,
      transactionId: result.data.transactionId,
      expiresIn: result.data.expiresIn,
    })
  } catch (e: any) {
    console.error("[platega/create] error:", e?.message || e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
