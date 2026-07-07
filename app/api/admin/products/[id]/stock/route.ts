import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { randomUUID } from "crypto"

export const dynamic = "force-dynamic"

// Add stock items to a product
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const body = await req.json().catch(() => ({}))
    const { count, content } = body as { count?: number; content?: string }

    const product = await db.product.findUnique({ where: { id } })
    if (!product) {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
    }

    const n = Math.min(Math.max(Number(count) || 1, 1), 1000)
    const hasContent = !!(content && content.trim())

    // FIX 9: if content is provided AND count > 1, reject — otherwise every
    // duplicated stock item would carry the same exact content.
    if (hasContent && n > 1) {
      return NextResponse.json(
        { error: "Для массового добавления оставьте content пустым" },
        { status: 400 }
      )
    }

    const created = []
    for (let i = 0; i < n; i++) {
      // Only auto-generate when content is absent.
      const c = hasContent
        ? content
        : `STOCK-${product.slug.toUpperCase()}-${randomUUID().slice(0, 10).toUpperCase()}`
      created.push(
        db.stockItem.create({
          data: { productId: id, content: c, status: "available" },
        })
      )
    }
    await Promise.all(created)

    const available = await db.stockItem.count({
      where: { productId: id, status: "available" },
    })
    return NextResponse.json({ added: n, available })
  } catch (e: any) {
    console.error("[admin/products/stock] POST failed:", e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}

// List stock items
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const stock = await db.stockItem.findMany({
    where: { productId: id },
    orderBy: { createdAt: "desc" },
    take: 100,
  })
  return NextResponse.json({ stock })
}
