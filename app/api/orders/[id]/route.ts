import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

// Mark order as paid + auto-deliver stock
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { action } = body as { action: "pay" | "cancel" | "complete" | "refund" }

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true, customer: true },
  })
  if (!order) return NextResponse.json({ error: "Не найден" }, { status: 404 })

  if (action === "pay" || action === "complete") {
    // Deliver: assign stock items to each order item
    const updatedItems = []
    for (const it of order.items) {
      const product = await db.product.findUnique({ where: { id: it.productId } })
      // Skip stock delivery for services (already marked "в работе")
      if (product?.type === "service") {
        // ensure delivered text is set
        if (!it.delivered) {
          const updated = await db.orderItem.update({
            where: { id: it.id },
            data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой — старт в течение 1 часа." },
          })
          updatedItems.push(updated)
        } else {
          updatedItems.push(it)
        }
        await db.product.update({
          where: { id: it.productId },
          data: { salesCount: { increment: it.qty } },
        })
        continue
      }
      const stock = await db.stockItem.findMany({
        where: { productId: it.productId, status: "reserved" },
        take: it.qty,
      })
      // If not enough reserved, take available
      if (stock.length < it.qty) {
        const more = await db.stockItem.findMany({
          where: { productId: it.productId, status: "available" },
          take: it.qty - stock.length,
        })
        stock.push(...more)
      }
      const ids = stock.map((s) => s.id)
      await db.stockItem.updateMany({
        where: { id: { in: ids } },
        data: { status: "sold", soldAt: new Date() },
      })
      const content = stock.map((s) => s.content).join("\n")
      const updated = await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: content },
      })
      updatedItems.push(updated)

      // Increase sales count
      await db.product.update({
        where: { id: it.productId },
        data: { salesCount: { increment: it.qty } },
      })
    }

    const updated = await db.order.update({
      where: { id },
      data: { status: "completed" },
      include: { items: true, customer: true },
    })

    // Update customer totals
    if (updated.customer) {
      await db.customer.update({
        where: { id: updated.customer.id },
        data: {
          totalSpent: { increment: updated.total },
          ordersCount: { increment: 1 },
        },
      })
    }
    return NextResponse.json({ order: updated })
  }

  if (action === "cancel") {
    // Release reserved stock
    for (const it of order.items) {
      const stock = await db.stockItem.findMany({
        where: { productId: it.productId, status: "reserved" },
        take: it.qty,
      })
      await db.stockItem.updateMany({
        where: { id: { in: stock.map((s) => s.id) } },
        data: { status: "available" },
      })
    }
    const updated = await db.order.update({
      where: { id },
      data: { status: "cancelled" },
    })
    return NextResponse.json({ order: updated })
  }

  if (action === "refund") {
    const updated = await db.order.update({
      where: { id },
      data: { status: "refunded" },
    })
    return NextResponse.json({ order: updated })
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 })
}
