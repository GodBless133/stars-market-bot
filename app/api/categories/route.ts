import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  // Single groupBy for available stock — avoids N+1 db.stockItem.count() calls.
  const [categories, stockCounts] = await Promise.all([
    db.category.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        products: {
          where: { active: true },
          select: { id: true, type: true, slug: true },
        },
      },
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

  const visibleCategories = categories.map((c) => {
    const visibleCount = c.products.filter(
      (p) => isVirtualOrService(p) || (stockMap.get(p.id) ?? 0) > 0
    ).length
    return {
      id: c.id,
      name: c.name,
      slug: c.slug,
      description: c.description,
      icon: c.icon,
      sortOrder: c.sortOrder,
      _count: { products: visibleCount },
    }
  })

  const withProducts = visibleCategories.filter((c) => c._count.products > 0)

  return NextResponse.json({ categories: withProducts })
}
