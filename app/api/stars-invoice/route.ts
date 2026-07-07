import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { genOrderNumber } from "@/lib/store"

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
    items: { productId: string; qty: number }[]
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
  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "Корзина пуста" }, { status: 400 })
  }

  // Fetch products
  const productIds = items.map((i) => i.productId)
  const products = await db.product.findMany({
    where: { id: { in: productIds }, active: true },
  })
  if (products.length !== productIds.length) {
    return NextResponse.json({ error: "Некоторые товары недоступны" }, { status: 400 })
  }

  // Check stock (skip services)
  for (const it of items) {
    const p = products.find((x) => x.id === it.productId)!
    if (p.type === "service") continue
    const available = await db.stockItem.count({
      where: { productId: p.id, status: "available" },
    })
    if (available < it.qty) {
      return NextResponse.json({ error: `Недостаточно товара: ${p.title}` }, { status: 400 })
    }
  }

  // Resolve customer
  let customer = null
  if (customerTg) {
    customer = await db.customer.upsert({
      where: { tgId: customerTg },
      update: { firstName: customerName },
      create: { tgId: customerTg, firstName: customerName },
    })
  }

  const totalRub = items.reduce((s, it) => {
    const p = products.find((x) => x.id === it.productId)!
    return s + p.price * it.qty
  }, 0)
  const totalStars = rubToStars(totalRub)

  // Create pending order
  const order = await db.order.create({
    data: {
      number: genOrderNumber(),
      customerId: customer?.id,
      customerTg: customerTg || null,
      customerName: customerName || null,
      status: "pending",
      total: totalRub,
      payMethod: "stars",
      items: {
        create: items.map((it) => {
          const p = products.find((x) => x.id === it.productId)!
          return { productId: p.id, title: p.title, price: p.price, qty: it.qty }
        }),
      },
    },
    include: { items: true },
  })

  // Reserve stock (skip services, mark service items "в работе")
  for (const it of order.items) {
    const p = products.find((x) => x.id === it.productId)!
    if (p.type === "service") {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой — старт в течение 1 часа." },
      })
      continue
    }
    const reserved = await db.stockItem.findMany({
      where: { productId: it.productId, status: "available" },
      take: it.qty,
    })
    await db.stockItem.updateMany({
      where: { id: { in: reserved.map((r) => r.id) } },
      data: { status: "reserved" },
    })
  }

  // Build label
  const label =
    items.length === 1
      ? products[0].title
      : `Заказ ${order.number} (${items.length} тов.)`

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
    // Rollback: cancel the order + release stock
    await db.order.update({ where: { id: order.id }, data: { status: "cancelled" } })
    for (const it of order.items) {
      const p = products.find((x) => x.id === it.productId)!
      if (p.type === "service") continue
      const stock = await db.stockItem.findMany({
        where: { productId: it.productId, status: "reserved" },
        take: it.qty,
      })
      await db.stockItem.updateMany({
        where: { id: { in: stock.map((s) => s.id) } },
        data: { status: "available" },
      })
    }
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
