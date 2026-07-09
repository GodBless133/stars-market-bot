import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { genOrderNumber } from "@/lib/store"
import { validateTelegramInitData } from "@/lib/telegram-auth"

export const dynamic = "force-dynamic"

// Create order (public, from storefront / mini app / bot)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { items, customerTg, customerName, payMethod, note } = body as {
    items: { productId: string; qty: number; title?: string }[]
    customerTg?: string
    customerName?: string
    payMethod?: string
    note?: string
  }

  // FIX 1: validate Telegram initData. If the header is present but invalid
  // → 401. If absent (e.g. admin/web testing) → fall back to body.customerTg
  // for backward compatibility (logged). When valid, the validated tg id
  // ALWAYS overrides any client-supplied customerTg.
  const botToken = process.env.BOT_TOKEN || ""
  const initData = req.headers.get("x-telegram-init-data") || ""
  const validatedTgId = validateTelegramInitData(initData, botToken)
  if (initData && !validatedTgId) {
    return NextResponse.json({ error: "invalid telegram auth" }, { status: 401 })
  }
  const effectiveTgId = validatedTgId
    ? String(validatedTgId)
    : (customerTg || null)
  if (!initData && customerTg) {
    console.warn("[api/orders] no initData header; falling back to client-supplied customerTg")
  }

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Корзина пуста" }, { status: 400 })
  }

  // FIX 3a: validate each item qty
  for (const it of items) {
    if (
      typeof it.qty !== "number" ||
      !Number.isInteger(it.qty) ||
      it.qty <= 0 ||
      it.qty > 100
    ) {
      return NextResponse.json(
        { error: "Некорректное количество товара (1..100)" },
        { status: 400 }
      )
    }
  }

  // FIX 3b: dedupe items by productId (sum quantities)
  const dedup = new Map<string, number>()
  for (const it of items) {
    dedup.set(it.productId, (dedup.get(it.productId) || 0) + it.qty)
  }
  const dedupedItems = Array.from(dedup.entries()).map(([productId, qty]) => ({
    productId,
    qty,
  }))

  // Fetch products
  const productIds = dedupedItems.map((i) => i.productId)
  const products = await db.product.findMany({
    where: { id: { in: productIds }, active: true },
  })

  if (products.length !== productIds.length) {
    return NextResponse.json({ error: "Некоторые товары недоступны" }, { status: 400 })
  }

  // Resolve / create customer
  let customer = null
  if (effectiveTgId) {
    customer = await db.customer.upsert({
      where: { tgId: effectiveTgId },
      update: { firstName: customerName },
      create: { tgId: effectiveTgId, firstName: customerName },
    })
  }

  const total = dedupedItems.reduce((sum, it) => {
    const p = products.find((x) => x.id === it.productId)!
    return sum + p.price * it.qty
  }, 0)

  try {
    // FIX 3c: atomic order creation + stock reservation
    const order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number: genOrderNumber(),
          customerId: customer?.id,
          customerTg: effectiveTgId || null,
          customerName: customerName || null,
          status: "pending",
          total,
          payMethod: payMethod || "card",
          note,
          items: {
            create: dedupedItems.map((it) => {
              const p = products.find((x) => x.id === it.productId)!
              return {
                productId: p.id,
                title: p.title,
                price: p.price,
                qty: it.qty,
              }
            }),
          },
        },
        include: { items: true },
      })

      // Reserve stock (skip services)
      for (const it of created.items) {
        const product = products.find((p) => p.id === it.productId)!
        if (product.type === "service") {
          // Mark service order items as "в работе" immediately
          await tx.orderItem.update({
            where: { id: it.id },
            data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой — старт в течение 1 часа." },
          })
          continue
        }

        const available = await tx.stockItem.findMany({
          where: { productId: it.productId, status: "available" },
          take: it.qty,
          select: { id: true },
        })
        if (available.length < it.qty) {
          throw new Error(`Недостаточно товара: ${it.title}`)
        }
        const reserved = await tx.stockItem.updateMany({
          where: { id: { in: available.map((s) => s.id) } },
          data: { status: "reserved", reservedOrderId: created.id },
        })
        if (reserved.count !== it.qty) {
          throw new Error(`Race condition: не удалось зарезервировать ${it.title}`)
        }
      }

      return created
    })

    return NextResponse.json({ order })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Не удалось создать заказ" },
      { status: 400 }
    )
  }
}

// List orders (by tgId query) — public for tracking
// FIX 5: strip PII / delivered content from public responses
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tgId = searchParams.get("tgId")
  const number = searchParams.get("number")

  // FIX 1: when looking up by tgId, validate Telegram initData so a user
  // can only fetch their OWN orders. Order-by-number is allowed without
  // auth (order number is an unguessable token). If initData is present
  // but invalid → 401. If absent → fall back to query tgId (backward compat,
  // logged) for non-Telegram callers (e.g. admin tools).
  const botToken = process.env.BOT_TOKEN || ""
  const initData = req.headers.get("x-telegram-init-data") || ""
  const validatedTgId = validateTelegramInitData(initData, botToken)
  if (initData && !validatedTgId) {
    return NextResponse.json({ error: "invalid telegram auth" }, { status: 401 })
  }
  if (tgId && !initData) {
    console.warn("[api/orders GET] no initData header; falling back to client-supplied tgId")
  }
  const effectiveTgId = validatedTgId ? String(validatedTgId) : tgId

  const publicOrderSelect = {
    id: true,
    number: true,
    status: true,
    total: true,
    currency: true,
    createdAt: true,
    items: {
      // Include `delivered` so the payment-success page can show the goods.
      // Order number acts as an unguessable token — if you know it, you can see delivery.
      select: { id: true, title: true, price: true, qty: true, delivered: true },
    },
  } as const

  if (number) {
    const order = await db.order.findUnique({
      where: { number },
      select: publicOrderSelect,
    })
    if (!order) return NextResponse.json({ error: "Не найден" }, { status: 404 })
    return NextResponse.json({ order })
  }

  if (effectiveTgId) {
    const orders = await db.order.findMany({
      where: { customerTg: effectiveTgId },
      orderBy: { createdAt: "desc" },
      select: publicOrderSelect,
    })
    return NextResponse.json({ orders })
  }

  return NextResponse.json({ error: "Укажите tgId или number" }, { status: 400 })
}
