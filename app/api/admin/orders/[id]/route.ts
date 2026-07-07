import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

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
    // Deliver: assign stock items to each order item.
    // FIX 10: if stock is insufficient, do NOT mark completed; set delivered
    // to a warning string and leave the order status as "paid".
    let allDelivered = true

    for (const it of order.items) {
      // `it.delivered` may be a real delivery OR a "⚠️ Недостаточно товара"
      // warning from a previous incomplete attempt. Only skip re-delivery for
      // real deliveries (so the admin can retry after restocking).
      if (it.delivered && !it.delivered.startsWith("⚠️")) {
        // already delivered (e.g. service "в работе") — just bump sales
        await db.product.update({
          where: { id: it.productId },
          data: { salesCount: { increment: it.qty } },
        })
        continue
      }
      const product = await db.product.findUnique({ where: { id: it.productId } })
      if (product?.type === "service") {
        await db.orderItem.update({
          where: { id: it.id },
          data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой — старт в течение 1 часа." },
        })
        await db.product.update({
          where: { id: it.productId },
          data: { salesCount: { increment: it.qty } },
        })
        continue
      }
      const stock = await db.stockItem.findMany({
        where: { productId: it.productId, status: { in: ["reserved", "available"] } },
        take: it.qty,
      })

      if (stock.length < it.qty) {
        // Insufficient stock — flag and mark incomplete
        console.warn(
          `[admin/orders/${id}] insufficient stock for item ${it.id} (product ${it.productId}): have ${stock.length}, need ${it.qty}`
        )
        await db.orderItem.update({
          where: { id: it.id },
          data: { delivered: "⚠️ Недостаточно товара на складе" },
        })
        allDelivered = false
        continue
      }

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
        where: { id: it.productId },
        data: { salesCount: { increment: it.qty } },
      })
    }

    if (allDelivered) {
      const updated = await db.order.update({
        where: { id },
        data: { status: "completed" },
        include: { items: true, customer: true },
      })
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

    // Not fully delivered — keep status as "paid" and return current state
    const updated = await db.order.update({
      where: { id },
      data: { status: "paid" },
      include: { items: true, customer: true },
    })
    return NextResponse.json({ order: updated })
  }

  if (action === "cancel") {
    // FIX 4: scope release by reservedOrderId
    await db.stockItem.updateMany({
      where: { reservedOrderId: order.id },
      data: { status: "available", reservedOrderId: null },
    })
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const order = await db.order.findUnique({
      where: { id },
      include: { items: true, customer: true },
    })
    if (!order) {
      return NextResponse.json({ error: "Не найден" }, { status: 404 })
    }

    // FIX 15: release any reserved stock scoped to this order
    await db.stockItem.updateMany({
      where: { reservedOrderId: id },
      data: { status: "available", reservedOrderId: null },
    })

    // If the order was completed, best-effort reverse customer totals & product sales
    if (order.status === "completed") {
      try {
        if (order.customerId) {
          await db.customer.update({
            where: { id: order.customerId },
            data: {
              totalSpent: { decrement: order.total },
              ordersCount: { decrement: 1 },
            },
          })
        }
        for (const it of order.items) {
          await db.product.update({
            where: { id: it.productId },
            data: { salesCount: { decrement: it.qty } },
          })
        }
      } catch (e) {
        console.warn(`[admin/orders/${id}] reverse counters failed:`, e)
      }
    }

    await db.order.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error(`[admin/orders/${id}] DELETE failed:`, e)
    return NextResponse.json({ error: "Не удалось удалить заказ" }, { status: 500 })
  }
}
