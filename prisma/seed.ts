// Seed script — run with: bun run db:seed
import { PrismaClient } from "@prisma/client"

const db = new PrismaClient()

async function main() {
  console.log("🌱 Seeding database...")

  // Skip if already seeded (idempotent — safe to run on Railway redeploy)
  const existingCats = await db.category.count()
  if (existingCats > 0) {
    console.log("✅ Database already seeded — skipping")
    return
  }

  // Settings
  await db.settings.upsert({
    where: { id: "singleton" },
    update: {},
    create: {
      id: "singleton",
      storeName: "Stars Market",
      tagline: "Аккаунты и Telegram Stars мгновенно",
      botUsername: "stars_market_bot",
      supportContact: "@support_stars",
      currency: "RUB",
    },
  })

  // Categories
  const categories = await Promise.all([
    db.category.upsert({
      where: { slug: "telegram-stars" },
      update: {},
      create: {
        name: "Telegram Stars",
        slug: "telegram-stars",
        description: "Telegram Stars для доната, подарков и подписок",
        icon: "⭐",
        sortOrder: 1,
      },
    }),
    db.category.upsert({
      where: { slug: "premium-accounts" },
      update: {},
      create: {
        name: "Premium аккаунты",
        slug: "premium-accounts",
        description: "Telegram Premium и аккаунты сервисов",
        icon: "👑",
        sortOrder: 2,
      },
    }),
    db.category.upsert({
      where: { slug: "virtual-numbers" },
      update: {},
      create: {
        name: "Виртуальные номера",
        slug: "virtual-numbers",
        description: "Номера для приёма SMS и регистрации",
        icon: "📱",
        sortOrder: 3,
      },
    }),
    db.category.upsert({
      where: { slug: "gifts" },
      update: {},
      create: {
        name: "Подарки",
        slug: "gifts",
        description: "Telegram Gifts и лимитированные стикеры",
        icon: "🎁",
        sortOrder: 4,
      },
    }),
  ])

  const [starsCat, premiumCat, numbersCat, giftsCat] = categories

  // Products
  const products = [
    {
      title: "Telegram Stars — 50 ⭐",
      slug: "stars-50",
      description: "50 Telegram Stars на ваш аккаунт. Мгновенная доставка.",
      price: 99,
      oldPrice: 129,
      categoryId: starsCat.id,
      type: "stars",
      badge: "Хит",
      featured: true,
      image: "stars",
    },
    {
      title: "Telegram Stars — 100 ⭐",
      slug: "stars-100",
      description: "100 Telegram Stars. Идеально для доната авторам.",
      price: 189,
      oldPrice: 229,
      categoryId: starsCat.id,
      type: "stars",
      badge: "−18%",
      featured: true,
      image: "stars",
    },
    {
      title: "Telegram Stars — 350 ⭐",
      slug: "stars-350",
      description: "350 Telegram Stars. Выгодный пакет с скидкой.",
      price: 599,
      oldPrice: 750,
      categoryId: starsCat.id,
      type: "stars",
      featured: true,
      image: "stars",
    },
    {
      title: "Telegram Stars — 1000 ⭐",
      slug: "stars-1000",
      description: "1000 Telegram Stars. Максимальная выгода.",
      price: 1690,
      oldPrice: 2100,
      categoryId: starsCat.id,
      type: "stars",
      badge: "−20%",
      featured: true,
      image: "stars",
    },
    {
      title: "Telegram Premium — 3 месяца",
      slug: "premium-3m",
      description: "Telegram Premium на 3 месяца. Увеличенные лимиты, стикеры, темы.",
      price: 449,
      oldPrice: 599,
      categoryId: premiumCat.id,
      type: "service",
      badge: "Популярно",
      featured: true,
      image: "premium",
    },
    {
      title: "Telegram Premium — 12 месяцев",
      slug: "premium-12m",
      description: "Telegram Premium на 12 месяцев. Лучшая цена за месяц.",
      price: 1490,
      oldPrice: 1990,
      categoryId: premiumCat.id,
      type: "service",
      badge: "−25%",
      featured: true,
      image: "premium",
    },
    {
      title: "Аккаунт Telegram + Premium",
      slug: "account-tg-premium",
      description: "Готовый аккаунт Telegram с Premium подпиской. Полный доступ, 2FA.",
      price: 890,
      categoryId: premiumCat.id,
      type: "account",
      featured: true,
      image: "account",
    },
    {
      title: "Виртуальный номер (RU) — 7 дней",
      slug: "number-ru-7d",
      description: "Виртуальный номер России для приёма SMS. Активация 7 дней.",
      price: 129,
      categoryId: numbersCat.id,
      type: "digital",
      image: "number",
    },
    {
      title: "Виртуальный номер (UA) — 30 дней",
      slug: "number-ua-30d",
      description: "Украинский виртуальный номер. Регистрация в любых сервисах.",
      price: 249,
      categoryId: numbersCat.id,
      type: "digital",
      image: "number",
    },
    {
      title: "Telegram Gift — Heart",
      slug: "gift-heart",
      description: "Лимитированный подарок Heart для отправки друзьям.",
      price: 159,
      categoryId: giftsCat.id,
      type: "digital",
      badge: "Limited",
      image: "gift",
    },
    {
      title: "Telegram Gift — Diamond",
      slug: "gift-diamond",
      description: "Премиум подарок Diamond. Редкий коллекционный предмет.",
      price: 499,
      categoryId: giftsCat.id,
      type: "digital",
      image: "gift",
    },
    {
      title: "Стартовый набор Stars",
      slug: "starter-bundle",
      description: "Набор: 100 Stars + Premium 1 месяц + номер на 7 дней.",
      price: 599,
      oldPrice: 899,
      categoryId: starsCat.id,
      type: "digital",
      badge: "Набор",
      image: "bundle",
    },
  ]

  for (const p of products) {
    const created = await db.product.upsert({
      where: { slug: p.slug },
      update: {},
      create: {
        ...p,
        currency: "RUB",
        longDesc: `${p.description}\n\nДоставка автоматически после оплаты. Поддержка 24/7. Гарантия на все товары.`,
        rating: 4 + Math.random(),
        salesCount: Math.floor(Math.random() * 500) + 20,
      },
    })

    // Create stock items for each product (so orders can be fulfilled)
    const stockCount = p.type === "stars" || p.type === "service" ? 8 : 5
    for (let i = 0; i < stockCount; i++) {
      const content =
        p.type === "stars"
          ? `STARS-GIFT-LINK-${created.slug.toUpperCase()}-${(Math.random().toString(36).slice(2, 10)).toUpperCase()}`
          : p.type === "account"
          ? `LOGIN:+79xxxxxxxxx|PASS:${Math.random().toString(36).slice(2, 10)}|2FA:${Math.random().toString(36).slice(2, 8).toUpperCase()}`
          : p.type === "service"
          ? `PREMIUM-GIFT-LINK-${(Math.random().toString(36).slice(2, 12)).toUpperCase()}`
          : `CODE-${created.slug.toUpperCase()}-${(Math.random().toString(36).slice(2, 12)).toUpperCase()}`
      await db.stockItem.create({
        data: { productId: created.id, content, status: "available" },
      })
    }
  }

  // Demo customer + reviews
  const demoCustomers = [
    { tgId: "100001", username: "alex_k", firstName: "Алексей" },
    { tgId: "100002", username: "marina_v", firstName: "Марина" },
    { tgId: "100003", username: "dmitry_p", firstName: "Дмитрий" },
    { tgId: "100004", username: "olya_s", firstName: "Ольга" },
    { tgId: "100005", username: "ivan_t", firstName: "Иван" },
  ]
  const createdCustomers = []
  for (const c of demoCustomers) {
    createdCustomers.push(
      await db.customer.upsert({
        where: { tgId: c.tgId },
        update: {},
        create: c,
      })
    )
  }

  const allProducts = await db.product.findMany()
  const reviewTexts = [
    "Всё пришло моментально, спасибо! Буду заказывать ещё.",
    "Отличный сервис, поддержка ответила за 2 минуты.",
    "Цены ниже чем у всех, рекомендую.",
    "Уже третий заказ, всё стабильно работает.",
    "Звёзды зачислились сразу, Premium активировался без проблем.",
    "Лучший магазин звёзд, проверено.",
    "Всё чётко, номер принял SMS без сбоев.",
    "Подарок отправился другу, он доволен. Спасибо!",
  ]
  for (let i = 0; i < 24; i++) {
    const product = allProducts[i % allProducts.length]
    const customer = createdCustomers[i % createdCustomers.length]
    await db.review.create({
      data: {
        productId: product.id,
        customerId: customer.id,
        author: customer.firstName || customer.username || "Пользователь",
        tgId: customer.tgId,
        rating: 4 + (i % 2),
        text: reviewTexts[i % reviewTexts.length],
        published: true,
      },
    })
  }

  // Recompute ratings
  for (const p of allProducts) {
    const agg = await db.review.aggregate({
      where: { productId: p.id, published: true },
      _avg: { rating: true },
      _count: true,
    })
    await db.product.update({
      where: { id: p.id },
      data: { rating: agg._avg.rating ?? 0 },
    })
  }

  // Demo orders
  const statuses = ["completed", "completed", "completed", "pending", "paid", "cancelled"]
  for (let i = 0; i < 18; i++) {
    const product = allProducts[i % allProducts.length]
    const customer = createdCustomers[i % createdCustomers.length]
    const status = statuses[i % statuses.length]
    const qty = 1
    const order = await db.order.create({
      data: {
        number: `ORD-${Date.now().toString(36).toUpperCase().slice(-6)}${i}`,
        customerId: customer.id,
        customerTg: customer.tgId,
        customerName: customer.firstName || undefined,
        status,
        total: product.price * qty,
        payMethod: i % 3 === 0 ? "stars" : i % 3 === 1 ? "card" : "crypto",
        items: {
          create: {
            productId: product.id,
            title: product.title,
            price: product.price,
            qty,
            delivered: status === "completed" ? "DELIVERED-CODE-XXX" : null,
          },
        },
      },
    })
    if (status === "completed") {
      await db.customer.update({
        where: { id: customer.id },
        data: {
          totalSpent: { increment: product.price * qty },
          ordersCount: { increment: 1 },
        },
      })
    }
  }

  console.log("✅ Seed complete")
  console.log(`   Categories: ${categories.length}`)
  console.log(`   Products: ${allProducts.length}`)
  console.log(`   Customers: ${createdCustomers.length}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
