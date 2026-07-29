# Перенос с Railway на Render.com (бесплатно)

## Что получите на Render
| Сервис | План | Стоимость |
|--------|------|-----------|
| PostgreSQL | Free (1GB) | 90 дней бесплатно |
| Next.js админка | Free (750ч/мес) | Бесплатно навсегда |
| Telegram-бот (worker) | Free (750ч/мес) | Бесплатно навсегда |
| MTProto Python | Free (750ч/мес) | Бесплатно навсегда |

**Итого: $0/мес** (после 90 дней PostgreSQL → $7/мес или бесплатный PostgreSQL от Supabase)

## Шаг 1. Зарегистрироваться на Render
1. Откройте https://render.com
2. Войдите через GitHub
3. **Карта не нужна** для Free плана

## Шаг 2. Создать Blueprint
1. В репозитории уже есть `render.yaml`
2. В Render → **New → Blueprint**
3. Выберите репозиторий `GodBless133/stars-market-bot`
4. Render автоматически создаст 4 сервиса из render.yaml
5. Заполните env-переменные (sync: false = ввести вручную)

## Шаг 3. Перенести базу данных с Railway

### Экспорт с Railway:
```bash
# Установите Railway CLI
npm install -g @railway/cli

# Авторизуйтесь
railway login

# Подключитесь к проекту
railway link -p ec85c365-8363-4f44-83c7-356fe2a057af

# Экспорт БД
railway run pg_dump --schema=public --data-only \
  "postgresql://postgres:PASSWORD@HOST:PORT/railway" \
  > railway_dump.sql
```

### Импорт на Render:
```bash
# После создания PostgreSQL на Render, получите DATABASE_URL
# Выполните импорт:
psql "postgresql://starsmarket:PASSWORD@RENDER_HOST/railway" \
  < railway_dump.sql
```

## Шаг 4. Настроить env-переменные

### В Render → starsmarket-admin (Web Service):
```
BOT_TOKEN=<ваш токен>
ADMIN_PASSWORD=<пароль админки>
ADMIN_TOKEN=<случайная строка 32+ символа>
ADMIN_TG_ID=<ваш TG ID>
PLATEGA_MERCHANT_ID=<merchant ID>
PLATEGA_SECRET=<secret>
DELIVER_KEY=<ключ доставки>
WEBAPP_URL=https://starsmarket-admin.onrender.com
```

### В Render → starsmarket-bot (Worker):
```
BOT_TOKEN=<тот же>
ADMIN_TG_ID=<тот же>
SMS_API_KEY=DlZIWO0FoakDk4WeyPbAQ8MWbXrYMw
SMM_API_KEY=<ключ twiboost>
MTPROTO_API_KEY=<ключ mtproto>
TG_API_ID=<api id>
TG_API_HASH=<api hash>
DELIVER_KEY=<тот же что у админки>
```

### В Render → starsmarket-mtproto (Web Service):
```
TG_API_ID=<api id>
TG_API_HASH=<api hash>
MTPROTO_API_KEY=<тот же>
```

## Шаг 5. Перенести домен

После деплоя на Render:
1. Админка: `https://starsmarket-admin.onrender.com`
2. В Platega → обновите webhook URL:
   `https://starsmarket-admin.onrender.com/api/platega/webhook`

## ⚠️ Ограничения Free плана Render

| Параметр | Render Free | Railway |
|----------|------------|---------|
| RAM | 512MB | ~512MB |
| CPU | Shared | Shared |
| Засыпание | Web сервисы засыпают через 15 мин без запросов | Не засыпает |
| Auto-deploy | ✅ из GitHub | ✅ |
| PostgreSQL | 90 дней бесплатно, потом $7/мес | Включён в план |

### Решение засыпания:
- Установите [UptimeRobot](https://uptimerobot.com) → пингуйте URL каждую минуту
- Или используйте cron-job.org для пинга /health

## Альтернативы (если Render не подойдёт)

### Ionos — $1/мес VPS
- 30 дней бесплатно, потом $1/мес
- Полный root, 1GB RAM, не засыпает
- Нужен Docker для деплоя

### Fly.io — $0/мес (free tier)
- 3 shared-cpu 1GB VMs
- 3GB постоянного хранилища
- Поддерживает Docker
