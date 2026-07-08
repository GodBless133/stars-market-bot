import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const category = searchParams.get("category")
  const featured = searchParams.get("featured")
  const search = searchParams.get("q")
  const sort = searchParams.get("sort") || "popular"

  const where: any = { active: true }
  if (category && category !== "all") {
    where.category = { slug: category }
  }
  if (featured === "1") where.featured = true
  if (search) {
    where.OR = [
      { title: { contains: search } },
      { description: { contains: search } },
    ]
  }

  let orderBy: any = { salesCount: "desc" }
  if (sort === "price-asc") orderBy = { price: "asc" }
  if (sort === "price-desc") orderBy = { price: "desc" }
  if (sort === "rating") orderBy = { rating: "desc" }
  if (sort === "new") orderBy = { createdAt: "desc" }

  // Single groupBy for available stock counts — avoids N+1 queries on 6000+ stock items.
  const [products, stockCounts] = await Promise.all([
    db.product.findMany({
      where,
      orderBy,
      include: { category: true },
    }),
    db.stockItem.groupBy({
      by: ["productId"],
      where: { status: "available" },
      _count: { _all: true },
    }),
  ])
  const stockMap = new Map(stockCounts.map((s) => [s.productId, s._count._all]))

  const isVirtualOrService = (p: any) =>
    p.type === "service" ||
    p.slug.includes("nomer") || p.slug.includes("number") || p.slug.includes("virtual")

  const visible = products
    .map((p) => ({
      ...p,
      inStock: isVirtualOrService(p) ? 99999 : (stockMap.get(p.id) ?? 0),
    }))
    .filter((p) => isVirtualOrService(p) || p.inStock > 0)

  return NextResponse.json({ products: visible })
}
