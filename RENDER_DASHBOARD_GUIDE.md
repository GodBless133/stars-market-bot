# Инструкция: перенос на Render через дашборд (без карты)

## Шаг 1. Создать PostgreSQL (бесплатно, 90 дней)

1. Откройте https://dashboard.render.com
2. Нажмите **New +** → **PostgreSQL**
3. Заполните:
   - Name: `starsmarket-db`
   - Database: `starsmarket`
   - User: `starsmarket`
   - Region: Oregon
   - Plan: **Free** (1GB, 90 дней бесплатно)
4. Нажмите **Create Database**
5. Дождитесь создания (~2 мин)
6. **Скопируйте Internal Database URL** — он понадобится ниже
   (вида: `postgresql://starsmarket:PASSWORD@d-host.internal:5432/starsmarket`)

## Шаг 2. Создать админку (Next.js)

1. Нажмите **New +** → **Web Service**
2. Выберите репозиторий **GodBless133/stars-market-bot**
3. Заполните:
   - Name: `starsmarket-admin`
   - Region: Oregon
   - Runtime: **Docker**
   - Dockerfile Path: `./Dockerfile.admin`
   - Docker Context: `.`
   - Plan: **Free**
4. Environment Variables (нажмите **Add Environment Variable** для каждой):
   ```
   DATABASE_URL          = <Internal Database URL из Шага 1>
   BOT_TOKEN             = 8974897264:AAF7tA6ZFEpPxz4v4Jo9ZuX6YS9tvQKY6AE
   ADMIN_PASSWORD        = StarsMarket2025
   ADMIN_TOKEN           = bdedcb65f6167ecf4bbc607fcc7517c0c6393429520908d63bca4f53bdf7b7ee
   ADMIN_TG_ID           = 7264716736
   PLATEGA_MERCHANT_ID   = a963aefb-c519-4211-828e-3642020bd54a
   PLATEGA_SECRET        = 2eGdgklHBb9Kz8AEdanSnnu8dgGUHAEybzJ9eDMB5pvpARtsPkMANxNmHgEiBp8cloDG4j1BFFxehwHJdvJcBdpeFoCmvj9uRSLI
   DELIVER_KEY           = 1b4689c2560019fb6d6a499668c741a994363a8ee8091f37
   BOT_INTERNAL_URL      = https://starsmarket-bot.onrender.com
   ```
5. Нажмите **Create Web Service**
6. Дождитесь билда (~5-10 мин)
7. URL: `https://starsmarket-admin.onrender.com`

## Шаг 3. Создать бота (Background Worker)

1. Нажмите **New +** → **Background Worker**
2. Выберите **GodBless133/stars-market-bot**
3. Заполните:
   - Name: `starsmarket-bot`
   - Region: Oregon
   - Runtime: **Docker**
   - Dockerfile Path: `./Dockerfile.bot`
   - Docker Context: `.`
   - Plan: **Free**
4. Environment Variables:
   ```
   DATABASE_URL          = <Internal Database URL из Шага 1>
   BOT_TOKEN             = 8974897264:AAF7tA6ZFEpPxz4v4Jo9ZuX6YS9tvQKY6AE
   WEBAPP_URL            = https://starsmarket-admin.onrender.com
   ADMIN_TG_ID           = 7264716736
   SMS_API_KEY           = DlZIWO0FoakDk4WeyPbAQ8MWbXrYMw
   SMM_API_KEY           = FzJus1iFSPZNDmAkEm3jY9ALIqXixkrcHROlRsQdDkQrMToT37aCjT7N5Rlb
   MTPROTO_API_URL       = https://starsmarket-mtproto.onrender.com
   MTPROTO_API_KEY       = 91ced59742faf5f601ee9ff2e23d65e13d65811494f5455c
   TG_API_ID             = 2040
   TG_API_HASH           = b18441a1ff607e10a989891a5462e627
   DELIVER_KEY           = 1b4689c2560019fb6d6a499668c741a994363a8ee8091f37
   PORT                  = 3004
   ```
5. Нажмите **Create Background Worker**

## Шаг 4. Создать MTProto (Python)

1. Нажмите **New +** → **Web Service**
2. Выберите **GodBless133/stars-market-bot**
3. Заполните:
   - Name: `starsmarket-mtproto`
   - Region: Oregon
   - Runtime: **Docker**
   - Dockerfile Path: `./mini-services/mtproto-api/Dockerfile`
   - Docker Context: `./mini-services/mtproto-api`
   - Plan: **Free**
4. Environment Variables:
   ```
   TG_API_ID             = 2040
   TG_API_HASH           = b18441a1ff607e10a989891a5462e627
   MTPROTO_API_KEY       = 91ced59742faf5f601ee9ff2e23d65e13d65811494f5455c
   ```
5. Нажмите **Create Web Service**

## Шаг 5. Перенести базу данных

После создания PostgreSQL на Render, выполните:

```bash
# 1. Экспорт с Railway (используйте Railway DATABASE_URL):
pg_dump "postgresql://postgres:ekigSBOckKrPcpdKmJNQWbGzIZdWZmjK@yamanote.proxy.rlwy.net:52058/railway" \
  --no-owner --no-privileges \
  > railway_export.sql

# 2. Импорт на Render (замените на ваш Render External Database URL):
psql "postgresql://starsmarket:PASSWORD@RENDER_EXTERNAL_HOST:PORT/starsmarket" \
  < railway_export.sql
```

## Шаг 6. Обновить Platega webhook

1. Откройте https://my.platega.io → Настройки → Callback URLs
2. Обновите URL:
   ```
   https://starsmarket-admin.onrender.com/api/platega/webhook
   ```

## Шаг 7. Настроить UptimeRobot (чтобы не засыпал)

Render Free засыпает через 15 мин без запросов.

1. Откройте https://uptimerobot.com → регистрация (бесплатно)
2. Add Monitor → HTTP(s)
3. URL: `https://starsmarket-admin.onrender.com/`
4. Interval: 5 minutes
5. Add another for: `https://starsmarket-mtproto.onrender.com/`

## Итог

| Сервис | Render URL | План |
|--------|-----------|------|
| PostgreSQL | internal | Free (90 дней) |
| Админка | https://starsmarket-admin.onrender.com | Free |
| Бот | worker (no URL) | Free |
| MTProto | https://starsmarket-mtproto.onrender.com | Free |

**Стоимость: $0/мес** (после 90 дней PostgreSQL → $7/мес или Supabase free)
