import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")
  const where: any = {}
  if (status) where.status = status

  // FIX 16: pagination — default page=1, limit=50, max limit=200
  const pageRaw = Number(searchParams.get("page")) || 1
  const limitRaw = Number(searchParams.get("limit")) || 50
  const page = Math.max(1, Math.floor(pageRaw))
  const limit = Math.max(1, Math.min(200, Math.floor(limitRaw)))

  const [orders, total] = await Promise.all([
    db.order.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        items: true,
        customer: true,
      },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.order.count({ where }),
  ])
  return NextResponse.json({ data: orders, page, limit, total })
}
