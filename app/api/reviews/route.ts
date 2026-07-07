import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"

// FIX 11: in-memory IP rate limiter — 1 review per 60s per IP
const RATE_LIMIT_MS = 60 * 1000
const ipLastPost = new Map<string, number>()

function getClientIp(req: NextRequest): string {
  const xff = req.headers.get("x-forwarded-for")
  if (xff) return xff.split(",")[0]!.trim()
  return req.headers.get("x-real-ip") || "unknown"
}

// Create review (public — без авторизации)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { productId, author, tgId, rating, text } = body as {
    productId?: string
    author: string
    tgId?: string
    rating: number
    text: string
  }

  // Валидация
  if (!author || !author.trim()) {
    return NextResponse.json({ error: "Укажите имя" }, { status: 400 })
  }
  if (!text || text.trim().length < 10) {
    return NextResponse.json({ error: "Текст отзыва минимум 10 символов" }, { status: 400 })
  }
  // FIX 11: require integer rating 1..5
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: "Оценка от 1 до 5 (целое число)" }, { status: 400 })
  }

  // FIX 11: rate-limit by IP regardless of tgId presence
  const ip = getClientIp(req)
  const now = Date.now()
  const last = ipLastPost.get(ip) || 0
  if (now - last < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: "Подождите минуту перед следующим отзывом" },
      { status: 429 }
    )
  }

  // Проверяем product если указан
  if (productId) {
    const product = await db.product.findUnique({ where: { id: productId } })
    if (!product) {
      return NextResponse.json({ error: "Товар не найден" }, { status: 404 })
    }
  }

  // Создаём/находим клиента если есть tgId
  let customer = null
  if (tgId) {
    customer = await db.customer.upsert({
      where: { tgId },
      update: { firstName: author },
      create: { tgId, firstName: author },
    })
  }

  const review = await db.review.create({
    data: {
      productId: productId || null,
      customerId: customer?.id || null,
      author: author.trim().slice(0, 50),
      tgId: tgId || null,
      rating: Math.round(rating),
      text: text.trim().slice(0, 500),
      published: true,
    },
  })

  // Record successful post for rate-limiting
  ipLastPost.set(ip, now)

  // Обновляем рейтинг товара
  if (productId) {
    const agg = await db.review.aggregate({
      where: { productId, published: true },
      _avg: { rating: true },
    })
    await db.product.update({
      where: { id: productId },
      data: { rating: agg._avg.rating ?? 0 },
    })
  }

  return NextResponse.json({ review, ok: true })
}

// List reviews
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get("productId")
  const published = searchParams.get("published")

  const where: any = {}
  if (productId) where.productId = productId
  if (published === "1") where.published = true
  if (published === "0") where.published = false

  const reviews = await db.review.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { product: { select: { title: true, image: true } } },
  })
  return NextResponse.json({ reviews })
}
