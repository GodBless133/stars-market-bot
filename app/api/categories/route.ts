import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET() {
  const categories = await db.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      products: {
        where: { active: true },
        select: { id: true, type: true, slug: true },
      },
    },
  })

  // Считаем только видимые товары (услуги + товары со stock > 0)
  const visibleCategories = await Promise.all(
    categories.map(async (c) => {
      let visibleCount = 0
      for (const p of c.products) {
        // Услуги и виртуальные номера всегда видны
        if (p.type === "service" || p.slug.includes("nomer") || p.slug.includes("number") || p.slug.includes("virtual")) {
          visibleCount++
          continue
        }
        // Остальные — проверяем stock
        const stock = await db.stockItem.count({
          where: { productId: p.id, status: "available" },
        })
        if (stock > 0) visibleCount++
      }
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
  )

  // Показываем только категории с товарами
  const withProducts = visibleCategories.filter((c) => c._count.products > 0)

  return NextResponse.json({ categories: withProducts })
}
