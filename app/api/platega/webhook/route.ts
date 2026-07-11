import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { validateWebhookHeaders } from "@/lib/platega"

export const dynamic = "force-dynamic"

// POST /api/platega/webhook
// Platega calls this endpoint when a transaction status changes.
// Headers: X-MerchantId, X-Secret. Body: { id, amount, currency, status, payload }
// status: "CONFIRMED" (paid) | "CANCELED" | "CHARGEBACKED" (refunded)
// payload: the order id we sent in createPayment
export async function POST(req: NextRequest) {
  try {
    // Auth: verify Platega headers
    if (!validateWebhookHeaders(req)) {
      console.warn("[platega/webhook] rejected — bad headers")
      return NextResponse.json({ error: "unauthorized" }, { status: 401 })
    }

    const body = await req.json().catch(() => ({}))
    const { id: transactionId, status, payload: orderId } = body as {
      id: string
      status: "CONFIRMED" | "CANCELED" | "CHARGEBACKED"
      payload: string
      amount?: number
      currency?: string
    }

    console.log("[platega/webhook] received:", { transactionId, status, orderId })

    if (!orderId) {
      console.warn("[platega/webhook] no payload (orderId) in body")
      return NextResponse.json({ ok: true }) // ACK so Platega doesn't retry
    }

    const order = await db.order.findUnique({
      where: { id: orderId },
      include: { items: true, customer: true },
    })
    if (!order) {
      console.warn("[platega/webhook] order not found:", orderId)
      return NextResponse.json({ ok: true }) // ACK
    }

    if (status === "CONFIRMED") {
      // Payment succeeded — mark as paid and deliver goods.
      // Idempotent: if already paid/completed, don't re-deliver.
      if (order.status === "pending") {
        await db.order.update({
          where: { id: order.id },
          data: { status: "paid", plategaTransactionId: transactionId },
        })

        // Determine if this order needs bot-side delivery (virtual numbers,
        // boost services) or can be delivered by Next.js directly (stock items).
        const firstItem = order.items[0]
        const product = firstItem ? await db.product.findUnique({
          where: { id: firstItem.productId },
          include: { category: true },
        }) : null

        const needsBotDelivery = product && (
          product.type === "service" ||
          product.type === "account" ||
          (product.category?.slug === "virtual-numbers") ||
          product.slug.includes("number") || product.slug.includes("virtual") ||
          product.title.toLowerCase().includes("виртуальн") || product.title.toLowerCase().includes("номер")
        )

        if (needsBotDelivery) {
          // Call bot's HTTP endpoint to deliver instantly (order SMS number,
          // notify buyer about boost link). Bot runs on Railway internal network.
          const botUrl = process.env.BOT_INTERNAL_URL || "http://localhost:3004"
          const deliverKey = process.env.DELIVER_KEY || ""
          try {
            console.log("[platega/webhook] calling bot /deliver-card-order for", order.number)
            await fetch(`${botUrl}/deliver-card-order`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Deliver-Key": deliverKey,
              },
              body: JSON.stringify({ orderId: order.id }),
              signal: AbortSignal.timeout(10000),
            })
            console.log("[platega/webhook] bot delivery triggered for", order.number)
          } catch (e: any) {
            console.error("[platega/webhook] bot delivery call failed:", e?.message || e)
            // Fallback: bot's 5-min poller will pick it up
          }
        } else {
          // Regular stock item — deliver directly from Next.js
          try {
            await deliverOrder(order.id)
            console.log("[platega/webhook] delivered order", order.number)
          } catch (e: any) {
            console.error("[platega/webhook] delivery failed:", e?.message || e)
            // Leave order as "paid" — admin can complete manually
          }
        }
      }
    } else if (status === "CANCELED") {
      // Payment failed — release reserved stock, cancel order
      if (order.status === "pending") {
        await db.stockItem.updateMany({
          where: { reservedOrderId: order.id },
          data: { status: "available", reservedOrderId: null },
        })
        await db.order.update({
          where: { id: order.id },
          data: { status: "cancelled", note: "Platega payment canceled" },
        })
        console.log("[platega/webhook] cancelled order", order.number)
      }
    } else if (status === "CHARGEBACKED") {
      // Refund issued — mark refunded, release stock if still reserved
      await db.stockItem.updateMany({
        where: { reservedOrderId: order.id },
        data: { status: "available", reservedOrderId: null },
      })
      // If stock was already sold, reverse it
      await db.stockItem.updateMany({
        where: { reservedOrderId: order.id, status: "sold" },
        data: { status: "available", soldAt: null, reservedOrderId: null },
      })
      await db.order.update({
        where: { id: order.id },
        data: { status: "refunded", note: "Platega chargeback" },
      })
      console.log("[platega/webhook] refunded order", order.number)
    }

    // ACK — Platega expects 200 OK
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[platega/webhook] error:", e?.message || e)
    // Still return 200 to stop retries — we don't want Platega to spam us
    return NextResponse.json({ ok: true, error: "processed with errors" })
  }
}

// Local delivery function — mirrors the bot's deliverOrder for card payments.
// For virtual numbers and boosts, the buyer must contact the bot (we can't send SMS
// from Next.js). For regular stock items, we deliver here directly.
async function deliverOrder(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })
  if (!order) return

  for (const it of order.items) {
    const product = await db.product.findUnique({ where: { id: it.productId } })
    if (!product) continue

    // FIX H-2: account-type orders are delivered by the bot (via /deliver-card-order),
    // which can send the inline "Получить код" button. Skip local delivery here so we
    // don't mark the orderItem delivered before the bot has a chance to run.
    if (product.type === "account") {
      // Skip — bot handles account delivery via /deliver-card-order
      continue
    }

    // Service/boost: just mark "в работе" — buyer contacts bot/support
    if (product.type === "service") {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой." },
      })
      continue
    }

    // Virtual number: buyer must go through the bot — mark pending
    const cat = await db.category.findUnique({ where: { id: product.categoryId } })
    const isVirtual = (cat?.slug === "virtual-numbers") ||
      product.slug.includes("number") || product.slug.includes("virtual") ||
      product.title.toLowerCase().includes("виртуальн") || product.title.toLowerCase().includes("номер")
    if (isVirtual) {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "📱 Номер будет заказан ботом. Откройте чат с ботом и нажмите «📦 Мои заказы»." },
      })
      continue
    }

    // Regular stock: fetch reserved items, mark sold, deliver content
    const stock = await db.stockItem.findMany({
      where: { reservedOrderId: order.id, status: "reserved" },
      take: it.qty,
    })
    if (stock.length > 0) {
      await db.stockItem.updateMany({
        where: { id: { in: stock.map((s) => s.id) } },
        data: { status: "sold", soldAt: new Date(), reservedOrderId: null },
      })
      const content = stock.map((s) => s.content).join("\n")
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: content },
      })
      await db.product.update({
        where: { id: product.id },
        data: { salesCount: { increment: stock.length } },
      })
    } else {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "⚠️ Недостаточно товара на складе. Свяжитесь с поддержкой." },
      })
    }
  }

  // Mark order completed
  await db.order.update({ where: { id: orderId }, data: { status: "completed" } })

  // Increment customer stats
  if (order.customerId) {
    await db.customer.update({
      where: { id: order.customerId },
      data: {
        totalSpent: { increment: order.total },
        ordersCount: { increment: 1 },
      },
    })
  }
}
