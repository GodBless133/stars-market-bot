import { NextRequest, NextResponse } from "next/server"
import { db } from "@/lib/db"
import { validateTelegramInitData } from "@/lib/telegram-auth"

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

  // FIX 1: validate Telegram initData. If present but invalid → 401. When
  // valid the validated tg id overrides body.tgId. Absent → fall back to
  // body.tgId (anonymous review still allowed for non-Telegram callers).
  const botToken = process.env.BOT_TOKEN || ""
  const initData = req.headers.get("x-telegram-init-data") || ""
  const validatedTgId = validateTelegramInitData(initData, botToken)
  if (initData && !validatedTgId) {
    return NextResponse.json({ error: "invalid telegram auth" }, { status: 401 })
  }
  const effectiveTgId = validatedTgId ? String(validatedTgId) : (tgId || null)
  if (!initData && tgId) {
    console.warn("[api/reviews POST] no initData header; falling back to client-supplied tgId")
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

  // Создаём/находим клиента если есть effectiveTgId
  let customer = null
  if (effectiveTgId) {
    customer = await db.customer.upsert({
      where: { tgId: effectiveTgId },
      update: { firstName: author },
      create: { tgId: effectiveTgId, firstName: author },
    })
  }

  const review = await db.review.create({
    data: {
      productId: productId || null,
      customerId: customer?.id || null,
      author: author.trim().slice(0, 50),
      tgId: effectiveTgId || null,
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

// List reviews — PUBLIC endpoint. FIX 2: force published=true so hidden /
// pending-moderation reviews can never leak. Admin uses /api/admin/reviews.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get("productId")

  const where: any = { published: true }
  if (productId) where.productId = productId

  const reviews = await db.review.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
    // FIX 6: never expose reviewer tgId / customerId on the public endpoint.
    select: {
      id: true,
      author: true,
      rating: true,
      text: true,
      createdAt: true,
      productId: true,
      published: true,
      product: { select: { title: true, image: true } },
    },
  })
  return NextResponse.json({ reviews })
}
