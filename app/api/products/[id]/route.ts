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
      reviews: {
        where: { published: true },
        // FIX 6: select only the fields needed for public display. Excludes
        // customerId / tgId so reviewers' Telegram ids can never leak.
        select: {
          id: true,
          author: true,
          rating: true,
          text: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      },
    },
  })
  if (!product) {
    return NextResponse.json({ error: "Не найдено" }, { status: 404 })
  }
  const available = await db.stockItem.count({
    where: { productId: product.id, status: "available" },
  })
  return NextResponse.json({ product: { ...product, inStock: available } })
}
