import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { getStatus } from "@/lib/platega"

export const dynamic = "force-dynamic"
export const maxDuration = 60

// GET /api/platega/poll?secret=XXX
// Fallback for webhook: checks all pending orders with plategaTransactionId
// and updates their status if Platega reports CONFIRMED/CANCELED.
// Can be called by a cron job (e.g. UptimeRobot / Railway cron) every 1-2 min.
// Also validates the caller with a secret query param to prevent abuse.
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get("secret")
  if (secret !== process.env.PLATEGA_POLL_SECRET && process.env.PLATEGA_POLL_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  let processed = 0
  let confirmed = 0
  let canceled = 0
  const errors: string[] = []

  try {
    const orders = await db.order.findMany({
      where: {
        status: "pending",
        plategaTransactionId: { not: null },
      },
      include: { items: true },
      take: 50,
    })

    for (const order of orders) {
      if (!order.plategaTransactionId) continue
      processed++
      try {
        const res = await getStatus(order.plategaTransactionId)
        if (!res.ok) {
          errors.push(`${order.number}: ${res.error}`)
          continue
        }
        const status = res.data.status
        if (status === "CONFIRMED") {
          await db.order.update({
            where: { id: order.id },
            data: { status: "paid" },
          })
          try {
            await deliverOrder(order.id)
            confirmed++
            console.log(`[platega/poll] delivered order ${order.number}`)
          } catch (e: any) {
            errors.push(`${order.number} delivery: ${e?.message || e}`)
          }
        } else if (status === "CANCELED" || status === "CHARGEBACKED") {
          await db.stockItem.updateMany({
            where: { reservedOrderId: order.id },
            data: { status: "available", reservedOrderId: null },
          })
          await db.order.update({
            where: { id: order.id },
            data: { status: status === "CHARGEBACKED" ? "refunded" : "cancelled" },
          })
          canceled++
          console.log(`[platega/poll] ${status} order ${order.number}`)
        }
      } catch (e: any) {
        errors.push(`${order.number}: ${e?.message || e}`)
      }
    }
  } catch (e: any) {
    errors.push("fatal: " + (e?.message || e))
  }

  return NextResponse.json({
    processed,
    confirmed,
    canceled,
    errors: errors.slice(0, 10),
  })
}

async function deliverOrder(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  })
  if (!order) return

  for (const it of order.items) {
    const product = await db.product.findUnique({ where: { id: it.productId } })
    if (!product) continue

    if (product.type === "service") {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с ботом — отправьте /support." },
      })
      continue
    }

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
        data: { delivered: "⚠️ Недостаточно товара. Свяжитесь с поддержкой." },
      })
    }
  }

  await db.order.update({ where: { id: orderId }, data: { status: "completed" } })

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
