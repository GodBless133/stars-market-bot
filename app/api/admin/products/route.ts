import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { randomUUID } from "crypto"

export const dynamic = "force-dynamic"

const VALID_TYPES = ["digital", "stars", "account", "service"] as const

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get("q")
  const active = searchParams.get("active")

  const where: any = {}
  if (q) {
    where.OR = [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }]
  }
  if (active === "1") where.active = true
  if (active === "0") where.active = false

  // FIX: was `include: { _count: { select: { stock: { where: { status: "available" } } } } }`
  // — filtered relation count caused N+1 subqueries and hung for 45+ seconds on
  // 6000+ stock items. Replaced with a single groupBy for available stock counts.
  const [products, stockCounts] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { category: true },
    }),
    db.stockItem.groupBy({
      by: ["productId"],
      where: { status: "available" },
      _count: { _all: true },
    }),
  ])
  const stockMap = new Map(stockCounts.map((s) => [s.productId, s._count._all]))
  return NextResponse.json({
    products: products.map((p) => ({
      ...p,
      inStock: stockMap.get(p.id) ?? 0,
    })),
  })
}

export async function POST(req: NextRequest) {
  try {
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

    // FIX 9: validate type
    const productType = type || "digital"
    if (!VALID_TYPES.includes(productType)) {
      return NextResponse.json(
        { error: `type должен быть одним из: ${VALID_TYPES.join(", ")}` },
        { status: 400 }
      )
    }

    // FIX 9: validate price is a non-negative number
    const numPrice = Number(price)
    if (!Number.isFinite(numPrice) || numPrice < 0) {
      return NextResponse.json(
        { error: "price должен быть неотрицательным числом" },
        { status: 400 }
      )
    }

    // FIX 9: validate categoryId exists
    const category = await db.category.findUnique({ where: { id: categoryId } })
    if (!category) {
      return NextResponse.json(
        { error: "Категория не найдена" },
        { status: 400 }
      )
    }

    // FIX 9: longer slug entropy
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9а-я]+/gi, "-")
        .replace(/^-+|-+$/g, "") +
      "-" +
      randomUUID().slice(0, 8)

    const product = await db.product.create({
      data: {
        title,
        slug,
        description,
        longDesc,
        price: numPrice,
        oldPrice: oldPrice ? Number(oldPrice) : null,
        categoryId,
        type: productType,
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
          content: `STOCK-${slug.toUpperCase()}-${randomUUID().slice(0, 10).toUpperCase()}`,
          status: "available",
        },
      })
    }

    return NextResponse.json({ product })
  } catch (e: any) {
    console.error("[admin/products] POST failed:", e)
    // Prisma FK / validation errors → 400
    if (e?.code === "P2002" || e?.code === "P2003" || e?.code === "P2014") {
      return NextResponse.json({ error: e.message || "validation error" }, { status: 400 })
    }
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
