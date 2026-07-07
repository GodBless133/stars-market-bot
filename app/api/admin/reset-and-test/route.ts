import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
export const dynamic = "force-dynamic"

// Diagnostic / maintenance endpoint.
// Now behind admin middleware (cookie-gated).
// GET: minimal health-check — does NOT dump session content or PII.
export async function GET() {
  try {
    const reservedCount = await db.stockItem.count({
      where: { status: "reserved" },
    })
    const availableCount = await db.stockItem.count({
      where: { status: "available" },
    })
    const soldCount = await db.stockItem.count({
      where: { status: "sold" },
    })
    return NextResponse.json({
      ok: true,
      stock: { reserved: reservedCount, available: availableCount, sold: soldCount },
    })
  } catch (e: any) {
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}

// POST: reset RESERVED stock for a given productId back to available.
// Requires productId in body or query. NEVER touches sold items.
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url)
    const queryProductId = url.searchParams.get("productId")
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }
    const productId = (body?.productId || queryProductId || "").trim()

    if (!productId) {
      return NextResponse.json(
        { error: "productId обязателен (в body или ?productId=...)" },
        { status: 400 }
      )
    }

    // Only reset RESERVED — never sold items.
    const reset = await db.stockItem.updateMany({
      where: { productId, status: "reserved" },
      data: { status: "available", reservedOrderId: null },
    })
    const available = await db.stockItem.count({
      where: { productId, status: "available" },
    })
    return NextResponse.json({ ok: true, reset: reset.count, available })
  } catch (e: any) {
    console.error("[admin/reset-and-test] POST failed:", e)
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 }
    )
  }
}
