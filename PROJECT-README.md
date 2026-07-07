# Stars Market — Полный проект

Магазин для продажи Telegram Stars, аккаунтов, накрутки и каналов.
Включает: админ-панель + Telegram Mini App + Telegram-бот с оплатой через Stars.

## 📦 Что в архиве

```
stars-market-full/
├── src/                       ← Next.js приложение (админка + Mini App)
│   ├── app/                   ← страницы + API routes
│   ├── components/            ← UI компоненты (админ, магазин, mini app)
│   ├── lib/                   ← утилиты, БД, состояние
│   └── hooks/                 ← React хуки
├── prisma/                    ← схема БД + seed-скрипты
│   ├── schema.prisma
│   ├── seed.ts                ← базовые товары
│   └── seed-additional.ts     ← доп. категории (накрутка, каналы)
├── mini-services/tg-bot/      ← Telegram-бот (встроен в основной проект)
├── bot-standalone/            ← ⭐ Автономный бот (отдельная папка для Railway)
├── deploy/                    ← конфиги для деплоя
│   ├── nginx/                 ← nginx конфиг
│   ├── systemd/               ← systemd сервисы
│   ├── railway/               ← Railway build hooks
│   └── scripts/               ← install.sh, status.sh
├── public/                    ← статика
├── package.json               ← зависимости Next.js
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── railway.admin.toml         ← Railway конфиг админки
├── railway.bot.toml           ← Railway конфиг бота
├── .env.example               ← шаблон переменных окружения
├── .gitignore
├── DEPLOY.md                  ← инструкция деплоя на VPS
├── RAILWAY.md                 ← инструкция деплоя на Railway
└── README.md                  ← этот файл
```

## 🚀 Быстрый старт

### Локально
```bash
tar -xzf stars-market-full.tar.gz
cd stars-market-full

# 1. Настроить .env
cp .env.example .env
# вписать BOT_TOKEN (уже в шаблоне) и DATABASE_URL

# 2. Установить зависимости
bun install                              # или npm install

# 3. Создать БД и наполнить товарами
bunx prisma generate
bunx prisma db push
bun run prisma/seed.ts
bun run prisma/seed-additional.ts

# 4. Запустить админку
bun run dev                              # http://localhost:3000, пароль admin123

# 5. Запустить бота (в другом терминале)
cd mini-services/tg-bot
bun install
bunx prisma generate
bun run dev                              # бот на :3004
```

### На Railway
См. `RAILWAY.md` — пошаговая инструкция.

### На VPS
См. `DEPLOY.md` — с nginx + systemd + HTTPS.

## 🔑 Переменные окружения

| Variable | Где нужно | Значение |
|----------|-----------|----------|
| `DATABASE_URL` | админка + бот | путь к БД (SQLite или PostgreSQL) |
| `BOT_TOKEN` | админка + бот | `<YOUR_BOT_TOKEN>` (получите у [@BotFather](https://t.me/BotFather)) |
| `WEBAPP_URL` | бот | URL Mini App (`https://домен/?app=1#app`) |

## 📂 Три варианта бота

1. **mini-services/tg-bot/** — встроенный бот (общая БД с админкой)
2. **bot-standalone/** — автономный бот (для отдельного деплоя на Railway)
3. Оба идентичны по функционалу

## ✨ Возможности

- Админ-панель: дашборд, товары, заказы, отзывы, клиенты, настройки
- Mini App: каталог, корзина, оплата Stars, мои заказы
- Бот: каталог, покупка, авто-выдача, история заказов
- 7 категорий, 27 товаров
- Оплата через Telegram Stars (XTR), курс 1 Star = 2 RUB

## 📝 Документация

- `DEPLOY.md` — деплой на VPS (nginx + systemd + Let's Encrypt)
- `RAILWAY.md` — деплой на Railway (2 сервиса + PostgreSQL)
- `bot-standalone/README.md` — инструкция для автономного бота
