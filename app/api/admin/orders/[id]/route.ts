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
    // FIX 4: run the entire delivery inside an interactive transaction with
    // a fresh fetch + re-check of `it.delivered` so concurrent "complete"
    // requests cannot double-count salesCount / totalSpent / sell stock twice.
    let allDelivered = true
    let updated: any = null
    try {
      const txResult = await db.$transaction(async (tx) => {
        // Re-fetch inside the transaction for a consistent snapshot.
        const freshOrder = await tx.order.findUnique({
          where: { id },
          include: { items: true, customer: true },
        })
        if (!freshOrder) throw new Error("order not found")

        for (const it of freshOrder.items) {
          // `it.delivered` may be a real delivery OR a "⚠️ Недостаточно товара"
          // warning from a previous incomplete attempt. Only skip re-delivery
          // for real deliveries (so the admin can retry after restocking).
          if (it.delivered && !it.delivered.startsWith("⚠️")) {
            // already delivered (e.g. service "в работе") — just bump sales
            await tx.product.update({
              where: { id: it.productId },
              data: { salesCount: { increment: it.qty } },
            })
            continue
          }
          const product = await tx.product.findUnique({
            where: { id: it.productId },
          })
          if (product?.type === "service") {
            await tx.orderItem.update({
              where: { id: it.id },
              data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой — старт в течение 1 часа." },
            })
            await tx.product.update({
              where: { id: it.productId },
              data: { salesCount: { increment: it.qty } },
            })
            continue
          }
          const stock = await tx.stockItem.findMany({
            where: {
              productId: it.productId,
              status: { in: ["reserved", "available"] },
            },
            take: it.qty,
          })

          if (stock.length < it.qty) {
            // Insufficient stock — flag and mark incomplete
            console.warn(
              `[admin/orders/${id}] insufficient stock for item ${it.id} (product ${it.productId}): have ${stock.length}, need ${it.qty}`
            )
            await tx.orderItem.update({
              where: { id: it.id },
              data: { delivered: "⚠️ Недостаточно товара на складе" },
            })
            allDelivered = false
            continue
          }

          await tx.stockItem.updateMany({
            where: { id: { in: stock.map((s) => s.id) } },
            data: { status: "sold", soldAt: new Date(), reservedOrderId: null },
          })
          const content = stock.map((s) => s.content).join("\n")
          await tx.orderItem.update({
            where: { id: it.id },
            data: { delivered: content },
          })
          await tx.product.update({
            where: { id: it.productId },
            data: { salesCount: { increment: it.qty } },
          })
        }

        if (allDelivered) {
          const upd = await tx.order.update({
            where: { id },
            data: { status: "completed" },
            include: { items: true, customer: true },
          })
          if (upd.customer) {
            await tx.customer.update({
              where: { id: upd.customer.id },
              data: {
                totalSpent: { increment: upd.total },
                ordersCount: { increment: 1 },
              },
            })
          }
          return upd
        }

        // Not fully delivered — keep status as "paid" and return current state
        return await tx.order.update({
          where: { id },
          data: { status: "paid" },
          include: { items: true, customer: true },
        })
      })
      updated = txResult
      return NextResponse.json({ order: updated })
    } catch (e: any) {
      console.error(`[admin/orders/${id}] complete tx failed:`, e)
      return NextResponse.json(
        { error: e?.message || "Не удалось завершить заказ" },
        { status: 500 }
      )
    }
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
