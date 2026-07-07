import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { genOrderNumber } from "@/lib/store"

export const dynamic = "force-dynamic"

// Create order (public, from storefront / mini app / bot)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { items, customerTg, customerName, payMethod, note } = body as {
    items: { productId: string; qty: number }[]
    customerTg?: string
    customerName?: string
    payMethod?: string
    note?: string
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

  // Check stock (skip for services — they don't need stock)
  for (const it of items) {
    const product = products.find((p) => p.id === it.productId)!
    if (product.type === "service") continue
    const available = await db.stockItem.count({
      where: { productId: product.id, status: "available" },
    })
    if (available < it.qty) {
      return NextResponse.json(
        { error: `Недостаточно товара: ${product.title}` },
        { status: 400 }
      )
    }
  }

  // Resolve / create customer
  let customer = null
  if (customerTg) {
    customer = await db.customer.upsert({
      where: { tgId: customerTg },
      update: { firstName: customerName },
      create: { tgId: customerTg, firstName: customerName },
    })
  }

  const total = items.reduce((sum, it) => {
    const p = products.find((x) => x.id === it.productId)!
    return sum + p.price * it.qty
  }, 0)

  const order = await db.order.create({
    data: {
      number: genOrderNumber(),
      customerId: customer?.id,
      customerTg: customerTg || null,
      customerName: customerName || null,
      status: "pending",
      total,
      payMethod: payMethod || "card",
      note,
      items: {
        create: items.map((it) => {
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

  // Reserve stock (skip for services)
  for (const it of order.items) {
    const product = products.find((p) => p.id === it.productId)!
    if (product.type === "service") {
      // Mark service order items as "в работе" immediately
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

  return NextResponse.json({ order })
}

// List orders (by tgId query) — public for tracking
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tgId = searchParams.get("tgId")
  const number = searchParams.get("number")

  if (number) {
    const order = await db.order.findUnique({
      where: { number },
      include: { items: true, customer: true },
    })
    if (!order) return NextResponse.json({ error: "Не найден" }, { status: 404 })
    return NextResponse.json({ order })
  }

  if (tgId) {
    const orders = await db.order.findMany({
      where: { customerTg: tgId },
      orderBy: { createdAt: "desc" },
      include: { items: true },
    })
    return NextResponse.json({ orders })
  }

  return NextResponse.json({ error: "Укажите tgId или number" }, { status: 400 })
}
