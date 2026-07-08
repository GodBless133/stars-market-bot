import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { genOrderNumber } from "@/lib/store"
import { validateTelegramInitData } from "@/lib/telegram-auth"

export const dynamic = "force-dynamic"

// Conversion rate: 1 Telegram Star = 2 RUB (configurable)
const STARS_PER_RUB = 0.5 // i.e. 2 RUB = 1 XTR

function rubToStars(rub: number): number {
  return Math.max(1, Math.round(rub * STARS_PER_RUB))
}

interface TgProduct {
  id: string
  title: string
  description: string
  price: number
  type: string
}

// Create a Telegram Stars invoice via Bot API createInvoiceLink.
// Returns the invoice link + the pending order id (payload).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { items, customerTg, customerName } = body as {
    items: { productId: string; qty: number; title?: string }[]
    customerTg?: string
    customerName?: string
  }

  const botToken = process.env.BOT_TOKEN?.trim()
  if (!botToken) {
    return NextResponse.json(
      { error: "BOT_TOKEN не настроен на сервере" },
      { status: 500 }
    )
  }

  // FIX 1: validate Telegram initData. If present but invalid → 401. When
  // valid the validated tg id overrides body.customerTg (no impersonation).
  // Absent → fall back to body.customerTg for non-Telegram callers (logged).
  const initData = req.headers.get("x-telegram-init-data") || ""
  const validatedTgId = validateTelegramInitData(initData, botToken)
  if (initData && !validatedTgId) {
    return NextResponse.json({ error: "invalid telegram auth" }, { status: 401 })
  }
  const effectiveTgId = validatedTgId
    ? String(validatedTgId)
    : (customerTg || null)
  if (!initData && customerTg) {
    console.warn("[api/stars-invoice] no initData header; falling back to client-supplied customerTg")
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

  // Resolve customer
  let customer = null
  if (effectiveTgId) {
    customer = await db.customer.upsert({
      where: { tgId: effectiveTgId },
      update: { firstName: customerName },
      create: { tgId: effectiveTgId, firstName: customerName },
    })
  }

  const totalRub = dedupedItems.reduce((s, it) => {
    const p = products.find((x) => x.id === it.productId)!
    return s + p.price * it.qty
  }, 0)
  const totalStars = rubToStars(totalRub)

  // FIX 3c: atomic order creation + stock reservation
  let order: { id: string; number: string; items: { id: string; productId: string; title: string; qty: number }[] }
  try {
    order = await db.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          number: genOrderNumber(),
          customerId: customer?.id,
          customerTg: effectiveTgId || null,
          customerName: customerName || null,
          status: "pending",
          total: totalRub,
          payMethod: "stars",
          items: {
            create: dedupedItems.map((it) => {
              const p = products.find((x) => x.id === it.productId)!
              return { productId: p.id, title: p.title, price: p.price, qty: it.qty }
            }),
          },
        },
        include: { items: true },
      })

      // Reserve stock (skip services, mark service items "в работе")
      for (const it of created.items) {
        const p = products.find((x) => x.id === it.productId)!
        if (p.type === "service") {
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
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Не удалось создать заказ" },
      { status: 400 }
    )
  }

  // Build label
  const label =
    dedupedItems.length === 1
      ? products[0].title
      : `Заказ ${order.number} (${dedupedItems.length} тов.)`

  // Call Telegram Bot API: createInvoiceLink with XTR currency (Stars)
  const tgRes = await fetch(
    `https://api.telegram.org/bot${botToken}/createInvoiceLink`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: label.slice(0, 32),
        description: `Оплата заказа ${order.number} звёздами Telegram Stars`,
        payload: JSON.stringify({ orderId: order.id, number: order.number }),
        currency: "XTR",
        prices: [{ label: label.slice(0, 32), amount: totalStars }],
        // For Stars payments provider_token is not needed (leave empty)
      }),
    }
  )
  const tgData = await tgRes.json()
  if (!tgData.ok) {
    // FIX 4: scoped rollback — release stock for this order, cancel order
    await db.$transaction(async (tx) => {
      await tx.stockItem.updateMany({
        where: { reservedOrderId: order.id },
        data: { status: "available", reservedOrderId: null },
      })
      await tx.order.update({ where: { id: order.id }, data: { status: "cancelled" } })
    })
    return NextResponse.json(
      { error: `Telegram API: ${tgData.description || "ошибка создания инвойса"}` },
      { status: 500 }
    )
  }

  const invoiceLink = tgData.result as string
  // Extract slug from "https://t.me/$SLUG" for openInvoice in Mini App
  const slugMatch = invoiceLink.match(/\$([A-Za-z0-9_-]+)/)
  const slug = slugMatch ? slugMatch[1] : null

  return NextResponse.json({
    orderId: order.id,
    orderNumber: order.number,
    totalRub,
    totalStars,
    invoiceLink,
    slug,
  })
}
