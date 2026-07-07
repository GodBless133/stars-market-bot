import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

// Public order actions — restricted to cancel only.
// Payment / completion / delivery is gated behind the admin API
// (app/api/admin/orders/[id]/route.ts) which is protected by middleware.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { action } = body as { action?: "cancel" | "pay" | "complete" | "refund" }

  const order = await db.order.findUnique({
    where: { id },
    include: { items: true },
  })
  if (!order) return NextResponse.json({ error: "Не найден" }, { status: 404 })

  if (action === "cancel") {
    // Release only the stock reserved for THIS order (scoped by reservedOrderId)
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

  // Any other action (pay / complete / refund / unknown) is forbidden on the public route
  return NextResponse.json(
    { error: "Действие недоступно. Обратитесь к администратору." },
    { status: 403 }
  )
}
