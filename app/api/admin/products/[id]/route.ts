import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const product = await db.product.findUnique({
    where: { id },
    include: {
      category: true,
      stock: { take: 50, orderBy: { createdAt: "desc" } },
      _count: { select: { reviews: true, orderItems: true } },
    },
  })
  if (!product) return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  return NextResponse.json({ product })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))

  const allowed = [
    "title",
    "description",
    "longDesc",
    "price",
    "oldPrice",
    "categoryId",
    "type",
    "badge",
    "image",
    "featured",
    "active",
  ]
  const data: any = {}
  for (const k of allowed) {
    if (k in body) data[k] = body[k]
  }
  if (data.price != null) data.price = Number(data.price)
  if (data.oldPrice != null) data.oldPrice = data.oldPrice ? Number(data.oldPrice) : null

  const product = await db.product.update({ where: { id }, data })
  return NextResponse.json({ product })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  await db.product.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
