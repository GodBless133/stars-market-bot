// Add-on seed: new categories + products for nakrutka, tg-channels, etc.
import { PrismaClient } from "@prisma/client"
const db = new PrismaClient()

async function main() {
  console.log("🌱 Add-on seed: new categories & products...")

  // Skip if already seeded (idempotent)
  const existing = await db.category.findUnique({ where: { slug: "tg-accounts" } })
  if (existing) {
    console.log("✅ Add-on seed already applied — skipping")
    return
  }

  // New categories
  const accountsCat = await db.category.upsert({
    where: { slug: "tg-accounts" },
    update: {},
    create: {
      name: "Telegram аккаунты",
      slug: "tg-accounts",
      description: "Готовые аккаунты Telegram с отлежкой",
      icon: "👤",
      sortOrder: 5,
    },
  })

  const boostCat = await db.category.upsert({
    where: { slug: "boost" },
    update: {},
    create: {
      name: "Накрутка",
      slug: "boost",
      description: "Накрутка подписчиков, просмотров, реакций",
      icon: "🚀",
      sortOrder: 6,
    },
  })

  const channelsCat = await db.category.upsert({
    where: { slug: "tg-channels" },
    update: {},
    create: {
      name: "Telegram каналы",
      slug: "tg-channels",
      description: "Готовые каналы с аудиторией",
      icon: "📢",
      sortOrder: 7,
    },
  })

  // Products: Telegram accounts
  const accProducts = [
    { title: "Аккаунт Telegram (отлежка 30 дней)", desc: "Аккаунт с отлежкой 30 дней. SMS верификация. 2FA по запросу.", price: 79, image: "account" },
    { title: "Аккаунт Telegram (отлежка 6 мес)", desc: "Отлежка 6 месяцев. Высокий траст. Идеально для накрутки и рассылок.", price: 199, image: "account" },
    { title: "Аккаунт Telegram USA (с номером)", desc: "Аккаунт с американским номером. Полный доступ, профиль заполнен.", price: 349, image: "account" },
    { title: "Авторег Telegram (100 шт)", desc: "100 свежих авторегов. Для массовых задач. Без отлежки.", price: 299, image: "bundle" },
  ]
  for (const p of accProducts) {
    const slug = p.title.toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 5)
    const product = await db.product.create({
      data: {
        title: p.title,
        slug,
        description: p.desc,
        longDesc: p.desc + "\n\nДоставка автоматически после оплаты. Гарантия на все товары.",
        price: p.price,
        categoryId: accountsCat.id,
        type: "account",
        currency: "RUB",
        rating: 4.5,
        salesCount: Math.floor(Math.random() * 200) + 10,
        featured: false,
        active: true,
        image: p.image,
      },
    })
    for (let i = 0; i < 5; i++) {
      await db.stockItem.create({
        data: {
          productId: product.id,
          content: `LOGIN:+79xxxxxxxxx|PASS:${Math.random().toString(36).slice(2, 10)}|2FA:${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          status: "available",
        },
      })
    }
  }

  // Products: Boost (накрутка) — services, no stock (delivered = "в работе")
  const boostProducts = [
    { title: "Накрутка подписчиков 1000", desc: "1000 подписчиков на канал/группу. Живые аккаунты, скорость 5-10K/день.", price: 149, badge: "Хит" },
    { title: "Накрутка подписчиков 5000", desc: "5000 подписчиков. Высокое качество, минимальный отток.", price: 649, badge: "−15%" },
    { title: "Накрутка подписчиков 10000", desc: "10000 подписчиков. Лучшее предложение для крупных каналов.", price: 1190, oldPrice: 1490, badge: "Выгода" },
    { title: "Накрутка просмотров 10000", desc: "10000 просмотров на последние 10 постов. Запуск в течение часа.", price: 89 },
    { title: "Накрутка просмотров 50000", desc: "50000 просмотров. Распределение на 20 последних постов.", price: 349 },
    { title: "Накрутка реакций 1000", desc: "1000 реакций (👍❤️🔥) на пост. На выбор эмодзи.", price: 99 },
    { title: "Премиум накрутка (живые)", desc: "1000 живых подписчиков с гарантией 30 дней. Без оттока.", price: 499, badge: "Premium" },
  ]
  for (const p of boostProducts) {
    const slug = p.title.toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 5)
    await db.product.create({
      data: {
        title: p.title,
        slug,
        description: p.desc,
        longDesc: p.desc + "\n\nПосле оплаты укажите ссылку на канал/пост в чате с поддержкой. Старт в течение 1 часа.",
        price: p.price,
        oldPrice: p.oldPrice || null,
        categoryId: boostCat.id,
        type: "service",
        currency: "RUB",
        rating: 4.7,
        salesCount: Math.floor(Math.random() * 300) + 20,
        featured: false,
        active: true,
        badge: p.badge || null,
        image: "bundle",
      },
    })
    // No stock for services — handled as "в работе"
  }

  // Products: Telegram channels
  const channelProducts = [
    { title: "Канал 1000 подписчиков (тематика: крипта)", desc: "Готовый канал 1000 живых подписчиков. Тематика: криптовалюта.", price: 1990 },
    { title: "Канал 5000 подписчиков (новости)", desc: "Канал с аудиторией 5000. Тематика: новости/медиа.", price: 8990 },
    { title: "Канал 10000 подписчиков (юмор)", desc: "Развлекательный канал, 10K аудитории. Активность высокая.", price: 18900 },
    { title: "Канал-стартап (чистый + 500 подписчиков)", desc: "Новый канал с 500 стартовыми подписчиками для быстрого старта.", price: 990 },
  ]
  for (const p of channelProducts) {
    const slug = p.title.toLowerCase().replace(/[^a-z0-9а-я]+/gi, "-").slice(0, 40) + "-" + Math.random().toString(36).slice(2, 5)
    await db.product.create({
      data: {
        title: p.title,
        slug,
        description: p.desc,
        longDesc: p.desc + "\n\nПосле оплаты вы получите полный доступ (админ + владелец) к каналу.",
        price: p.price,
        categoryId: channelsCat.id,
        type: "account",
        currency: "RUB",
        rating: 4.8,
        salesCount: Math.floor(Math.random() * 50) + 5,
        featured: false,
        active: true,
        image: "gift",
      },
    })
    // 1 stock per channel (each is unique)
    const created = await db.product.findFirst({ where: { slug }, orderBy: { createdAt: "desc" } })
    if (created) {
      await db.stockItem.create({
        data: {
          productId: created.id,
          content: `CHANNEL_TRANSFER_LINK: https://t.me/c/${Math.random().toString(36).slice(2, 12)} | Канал готов к передаче. Свяжитесь с поддержкой для оформления.`,
          status: "available",
        },
      })
    }
  }

  console.log("✅ Add-on seed complete")
  console.log(`   New categories: tg-accounts, boost, tg-channels`)
  console.log(`   New products: ${accProducts.length + boostProducts.length + channelProducts.length}`)
}

main().catch(console.error).finally(() => db.$disconnect())
