import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

// Add stock items to a product
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { count, content } = body as { count?: number; content?: string }

  const product = await db.product.findUnique({ where: { id } })
  if (!product) {
    return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
  }

  const n = Math.min(Math.max(Number(count) || 1, 1), 1000)
  const created = []
  for (let i = 0; i < n; i++) {
    const c = content && content.trim()
      ? content
      : `STOCK-${product.slug.toUpperCase()}-${Math.random().toString(36).slice(2, 12).toUpperCase()}`
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
