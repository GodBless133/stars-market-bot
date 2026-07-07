import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")
  const active = searchParams.get("active")

  const where: any = {}
  if (q) {
    where.OR = [{ title: { contains: q } }, { description: { contains: q } }]
  }
  if (active === "1") where.active = true
  if (active === "0") where.active = false

  const products = await db.product.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      category: true,
      _count: { select: { stock: { where: { status: "available" } } } },
    },
  })
  return NextResponse.json({
    products: products.map((p) => ({
      ...p,
      inStock: p._count.stock,
      _count: undefined,
    })),
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const {
    title,
    description,
    longDesc,
    price,
    oldPrice,
    categoryId,
    type,
    badge,
    image,
    featured,
    active,
    stockCount,
  } = body as any

  if (!title || !description || price == null || !categoryId) {
    return NextResponse.json({ error: "Заполните обязательные поля" }, { status: 400 })
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-+|-+$/g, "") + "-" + Math.random().toString(36).slice(2, 6)

  const product = await db.product.create({
    data: {
      title,
      slug,
      description,
      longDesc,
      price: Number(price),
      oldPrice: oldPrice ? Number(oldPrice) : null,
      categoryId,
      type: type || "digital",
      badge,
      image,
      featured: !!featured,
      active: active !== false,
      currency: "RUB",
    },
  })

  // Create stock items
  const count = Number(stockCount) || 0
  for (let i = 0; i < count; i++) {
    await db.stockItem.create({
      data: {
        productId: product.id,
        content: `STOCK-${slug.toUpperCase()}-${Math.random().toString(36).slice(2, 12).toUpperCase()}`,
        status: "available",
      },
    })
  }

  return NextResponse.json({ product })
}
