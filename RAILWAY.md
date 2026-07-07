# 🚂 Деплой на Railway

Railway — идеален для этого проекта: бесплатный тариф (trial $5), автодеплой из GitHub, встроенный PostgreSQL, автоматический HTTPS-домен.

## 📋 Что нужно заранее

1. **Аккаунт Railway**: https://railway.app (вход через GitHub)
2. **GitHub-репозиторий** с кодом проекта (залейте весь проект)
3. **Bot Token** от [@BotFather](https://t.me/BotFather)

---

## 🚀 Пошаговый деплой

### Шаг 1. Залить код на GitHub

Создайте репозиторий (приватный или публичный) и залейте весь код проекта:
```bash
cd /home/z/my-project
git init
git add .
git commit -m "Stars Market — initial"
git remote add origin https://github.com/ВАШ_ЛОГИН/stars-market.git
git push -u origin main
```

⚠️ **Важно**: убедитесь что `.gitignore` исключает `node_modules`, `.next`, `db/custom.db`, `.env`. Файлы `.env` **не должны попасть в GitHub** (там токен бота!).

### Шаг 2. Создать проект на Railway

1. Зайдите на https://railway.app → **New Project**
2. **Add PostgreSQL** — Railway создаст БД и даст `DATABASE_URL`
3. **Deploy from GitHub repo** — выберите ваш репозиторий

### Шаг 3. Развернуть админку (Service 1)

В проекте Railway → **New Service → GitHub Repo** → выберите репозиторий.

Настройки сервиса (вкладка **Settings**):
- **Root Directory**: `/` (корень)
- **Build Command**: `bash deploy/railway/build-admin.sh`
- **Start Command**: `bun run start`
- **Healthcheck Path**: `/`

Или используйте `railway.admin.toml` (Railway подхватит его автоматически).

**Variables** (вкладка Variables → Add Variable):
| Variable | Value | Откуда взять |
|----------|-------|--------------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | Railway подставит автоматически (reference на PostgreSQL plugin) |
| `BOT_TOKEN` | `***REDACTED_BOT_TOKEN***` | ваш токен |
| `NEXTAUTH_SECRET` | любой случайный (32 символа) | `openssl rand -hex 32` |

### Шаг 4. Развернуть бота (Service 2)

В проекте Railway → **New Service → GitHub Repo** → тот же репозиторий.

Настройки сервиса:
- **Root Directory**: `mini-services/tg-bot`
- **Build Command**: `bash ../../deploy/railway/build-bot.sh`
- **Start Command**: `bun run start`
- **Healthcheck Path**: `/health`

Или используйте `railway.bot.toml`.

**Variables**:
| Variable | Value |
|----------|-------|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (тот же, что у админки) |
| `BOT_TOKEN` | `***REDACTED_BOT_TOKEN***` |
| `WEBAPP_URL` | `https://ВАШ-АДМИН-ДОМЕН.up.railway.app/?app=1#app` |

> URL админки Railway выдаст после первого деплоя (вкладка **Settings → Networking → Generate Domain**).

### Шаг 5. Получить домен для админки

В сервисе админки → **Settings → Networking → Generate Domain**.

Railway выдаст адрес вида `stars-market-production.up.railway.app` (бесплатный, с HTTPS ✅).

Этот адрес впишите в `WEBAPP_URL` бота: `https://stars-market-production.up.railway.app/?app=1#app`

### Шаг 6. Привязать домен к боту в @BotFather

В [@BotFather](https://t.me/BotFather):
```
/setmenubutton
→ выбрать вашего бота
→ текст: 🛍 Открыть магазин
→ URL: https://stars-market-production.up.railway.app/?app=1#app
```

### Шаг 7. Тест!

1. Откройте вашего бота в Telegram → `/start` → «🛍 Каталог» → выберите товар → «Купить»
2. Бот пришлёт инвойс ⭐ → оплатите звёздами → товар придёт автоматически
3. Откройте админку: `https://stars-market-production.up.railway.app` → пароль `admin123`
4. В разделе «Заказы» увидите ваш заказ

Готово! 🎉

---

## 💰 Стоимость на Railway

- **Trial**: $5 бесплатно при регистрации (хватит на ~1 месяц работы обоих сервисов)
- **После trial**: ~$5/мес за оба сервиса + PostgreSQL (Hobby plan)
- Бот потребляет мало ресурсов (long-polling, ~50 МБ RAM)
- Админка на Next.js standalone (~150 МБ RAM)

---

## 🔧 Управление после деплоя

- **Логи**: в Railway дашборде → сервис → вкладка **Deploy** или **Logs**
- **Переменные**: сервис → **Variables**
- **Перезапуск**: сервис → **Settings → Redeploy**
- **Обновить код**: `git push` → Railway автоматически пересоберёт оба сервиса

---

## 🆘 Частые проблемы на Railway

### Build падает на `prisma generate`
- Убедитесь что добавили PostgreSQL-плагин и `DATABASE_URL` reference в переменные
- В логах билда должно быть `Environment variables loaded`

### Бот не отвечает после деплоя
- Проверьте логи сервиса бота — должен быть `Bot @... is up and polling`
- Убедитесь что `BOT_TOKEN` задан в Variables бота

### «BOT_TOKEN не настроен на сервере» в Mini App
- `BOT_TOKEN` должен быть в Variables **админки** (не только бота!) — нужен для `/api/stars-invoice`

### Mini App не открывается
- Должен быть HTTPS-домен (Railway даёт его автоматически)
- URL в `WEBAPP_URL` бота должен указывать на домен админки + `?app=1#app`

### Заказы из бота не видны в админке
- Оба сервиса должны использовать **один и тот же** `DATABASE_URL` (reference на PostgreSQL)
- Проверьте что `DATABASE_URL` в боте = `${{Postgres.DATABASE_URL}}`

### Падает билд админки на `next build`
- Проверьте логи — возможно TypeScript-ошибка
- В `next.config.ts` уже стоит `ignoreBuildErrors: true` и `ignoreDuringBuilds: true`

---

## 📁 Файлы для Railway в репозитории

```
railway.admin.toml        ← конфиг сервиса админки
railway.bot.toml          ← конфиг сервиса бота
deploy/railway/
├── build-admin.sh        ← билд-хук админки (sqlite→postgres + seed)
└── build-bot.sh          ← билд-хук бота (sqlite→postgres)
```

Эти файлы уже в проекте — просто залейте их на GitHub.
