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

  const products = await db.product.findMany({
    where,
    orderBy,
    include: { category: true },
  })

  const withStock = await Promise.all(
    products.map(async (p) => {
      // Для услуг и виртуальных номеров — всегда 99999 в наличии
      if (p.type === "service" || p.slug.includes("nomer") || p.slug.includes("number") || p.slug.includes("virtual")) {
        return { ...p, inStock: 99999 }
      }
      const available = await db.stockItem.count({
        where: { productId: p.id, status: "available" },
      })
      return { ...p, inStock: available }
    })
  )

  // Скрываем товары с stock=0 (кроме услуг и виртуальных номеров)
  const visible = withStock.filter(p =>
    p.type === "service" ||
    p.slug.includes("nomer") || p.slug.includes("number") || p.slug.includes("virtual") ||
    p.inStock > 0
  )

  return NextResponse.json({ products: visible })
}
