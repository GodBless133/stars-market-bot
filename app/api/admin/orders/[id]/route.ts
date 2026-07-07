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
    for (const it of order.items) {
      if (it.delivered) {
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
      await db.stockItem.updateMany({
        where: { id: { in: stock.map((s) => s.id) } },
        data: { status: "sold", soldAt: new Date() },
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

  if (action === "cancel") {
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

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await db.order.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
