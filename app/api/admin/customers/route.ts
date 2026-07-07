import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  // FIX 16: pagination — default page=1, limit=50, max limit=200
  const pageRaw = Number(searchParams.get("page")) || 1
  const limitRaw = Number(searchParams.get("limit")) || 50
  const page = Math.max(1, Math.floor(pageRaw))
  const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)))

  const [customers, total] = await Promise.all([
    db.customer.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { orders: true, reviews: true } } },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.customer.count(),
  ])
  return NextResponse.json({ data: customers, page, limit, total })
}
