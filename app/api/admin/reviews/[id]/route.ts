import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const body = await req.json().catch(() => ({}))
  const { published } = body as { published?: boolean }

  const data: any = {}
  if (typeof published === "boolean") data.published = published

  const review = await db.review.update({ where: { id }, data })

  // FIX 8: only recompute rating if productId is set
  if (review.productId) {
    const agg = await db.review.aggregate({
      where: { productId: review.productId, published: true },
      _avg: { rating: true },
    })
    await db.product.update({
      where: { id: review.productId },
      data: { rating: agg._avg.rating ?? 0 },
    })
  }

  return NextResponse.json({ review })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const review = await db.review.delete({ where: { id } })

  // FIX 8: only recompute rating if productId is set
  if (review.productId) {
    const agg = await db.review.aggregate({
      where: { productId: review.productId, published: true },
      _avg: { rating: true },
    })
    await db.product.update({
      where: { id: review.productId },
      data: { rating: agg._avg.rating ?? 0 },
    })
  }
  return NextResponse.json({ ok: true })
}
