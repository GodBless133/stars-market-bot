import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

const VALID_TYPES = ["digital", "stars", "account", "service"] as const

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
  try {
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

    // FIX 9: validate type if provided
    if (data.type != null && !VALID_TYPES.includes(data.type)) {
      return NextResponse.json(
        { error: `type должен быть одним из: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      )
    }

    // FIX 9: validate price if provided
    if (data.price != null) {
      const numPrice = Number(data.price)
      if (!Number.isFinite(numPrice) || numPrice < 0) {
        return NextResponse.json(
          { error: "price должен быть неотрицательным числом" },
          { status: 400 }
        )
      }
      data.price = numPrice
    }

    if (data.oldPrice != null) {
      data.oldPrice = data.oldPrice ? Number(data.oldPrice) : null
    }

    // FIX 9: validate categoryId exists if provided
    if (data.categoryId != null) {
      const category = await db.category.findUnique({ where: { id: data.categoryId } })
      if (!category) {
        return NextResponse.json({ error: "Категория не найдена" }, { status: 400 })
      }
    }

    const product = await db.product.update({ where: { id }, data })
    return NextResponse.json({ product })
  } catch (e: any) {
    console.error("[admin/products] PATCH failed:", e)
    if (e?.code === "P2002" || e?.code === "P2003" || e?.code === "P2014" || e?.code === "P2025") {
      return NextResponse.json({ error: e.message || "validation error" }, { status: 400 })
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    await db.product.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[admin/products] DELETE failed:", e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
