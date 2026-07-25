import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import crypto from "crypto"

export const dynamic = "force-dynamic"

// GET /api/admin/promos — список всех промокодов со статистикой
export async function GET() {
  try {
    const promos = await db.promoCode.findMany({
      orderBy: { createdAt: "desc" },
    })

    const totalRevenue = promos.reduce((sum, p) => sum + p.revenue, 0)
    const totalOrders = promos.reduce((sum, p) => sum + p.revenueOrders, 0)
    const totalUses = promos.reduce((sum, p) => sum + p.usesCount, 0)

    return NextResponse.json({
      promos: promos.map(p => ({
        ...p,
        remaining: p.maxUses - p.usesCount,
      })),
      totals: {
        revenue: totalRevenue,
        orders: totalOrders,
        uses: totalUses,
        count: promos.length,
      },
    })
  } catch (e: any) {
    console.error("[admin/promos] GET error:", e?.message || e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}

// POST /api/admin/promos — создать промокод
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { code, type, value, maxUses, assignedToTgId, note } = body as {
      code: string
      type: string
      value: number
      maxUses: number
      assignedToTgId?: string
      note?: string
    }

    if (!code || !type || !Number.isFinite(value) || !Number.isFinite(maxUses)) {
      return NextResponse.json({ error: "Заполните все поля" }, { status: 400 })
    }
    if (!["discount", "fixed", "stars"].includes(type)) {
      return NextResponse.json({ error: "Тип: discount | fixed | stars" }, { status: 400 })
    }

    const id = "c" + Date.now().toString(16) + crypto.randomBytes(8).toString("hex").slice(0, 16)
    const promo = await db.promoCode.create({
      data: {
        id,
        code: code.toUpperCase(),
        type,
        value: Number(value),
        maxUses: Number(maxUses),
        usesCount: 0,
        active: true,
        revenue: 0,
        revenueOrders: 0,
        assignedToTgId: assignedToTgId || null,
        note: note || null,
      },
    })

    return NextResponse.json({ promo })
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "Промокод с таким кодом уже существует" }, { status: 400 })
    }
    console.error("[admin/promos] POST error:", e?.message || e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}

// PATCH /api/admin/promos — обновить промокод (toggle active)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { id, active } = body as { id: string; active?: boolean }

    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 })
    }

    const data: any = {}
    if (active !== undefined) data.active = active

    await db.promoCode.update({ where: { id }, data })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[admin/promos] PATCH error:", e?.message || e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}

// DELETE /api/admin/promos — удалить промокод
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get("id")
    if (!id) {
      return NextResponse.json({ error: "id required" }, { status: 400 })
    }

    await db.promoCode.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error("[admin/promos] DELETE error:", e?.message || e)
    return NextResponse.json({ error: "internal error" }, { status: 500 })
  }
}
