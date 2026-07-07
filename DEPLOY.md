# 🚀 Инструкция по запуску на своём хосте

Магазин состоит из **двух сервисов** + базы данных SQLite:

| Сервис | Порт | Что это |
|--------|------|---------|
| Next.js (админка + Mini App) | 3000 | Веб-приложение |
| Telegram-бот (grammy) | 3004 | Бот с приёмом платежей |

Требования к хосту:
- **OS**: Linux (Ubuntu/Debian) или любой UNIX
- **RAM**: от 512 МБ
- **Доступ**: SSH + возможность открыть 2 порта (или 1 с nginx)
- **Домен** с HTTPS (нужен для Telegram Mini App) — можно бесплатный Let's Encrypt

---

## 📋 Вариант A: Быстрый запуск (dev-режим, просто проверить)

> Подходит для VPS «на попробовать». Не для продакшена, но работает стабильно.

### 1. Установить Bun

```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
bun --version  # должна появиться версия
```

### 2. Залить код на хост

Вариант 1 — через git (если репозиторий есть):
```bash
git clone https://github.com/ВАШ_РЕПО/stars-market.git
cd stars-market
```

Вариант 2 — архивом с локальной машины:
```bash
# локально (на этой песочнице):
tar --exclude='node_modules' --exclude='.next' --exclude='db/custom.db' \
    -czf stars-market.tar.gz -C /home/z/my-project .

# залить на хост:
scp stars-market.tar.gz user@ВАШ_ХОСТ:/home/user/
ssh user@ВАШ_ХОСТ
mkdir -p ~/stars-market && cd ~/stars-market
tar -xzf ~/stars-market.tar.gz
```

### 3. Настроить переменные окружения

```bash
cd ~/stars-market

# Основной .env (для админки — нужен BOT_TOKEN для создания Stars-инвойсов)
cat > .env << 'EOF'
DATABASE_URL=file:/home/z/my-project/db/custom.db
BOT_TOKEN=<YOUR_BOT_TOKEN>
EOF

# .env бота
cat > mini-services/tg-bot/.env << 'EOF'
BOT_TOKEN=<YOUR_BOT_TOKEN>
WEBAPP_URL=https://ВАШ-ДОМЕН/?app=1#app
DATABASE_URL="file:/home/user/stars-market/db/custom.db"
EOF
```

⚠️ Замените:
- `ВАШ_ДОМЕН` — ваш реальный домен (например `shop.example.com`)
- Путь в `DATABASE_URL` бота — на абсолютный путь к БД на вашем хосте

### 4. Установить зависимости и инициализировать БД

```bash
cd ~/stars-market
bun install
bun run db:push          # создать таблицы
bun run prisma/seed.ts   # демо-товары (НЕобязательно)

cd mini-services/tg-bot
bun install
bunx prisma generate
```

### 5. Запустить оба сервиса

В двух отдельных терминалах (или через tmux/screen):

```bash
# Терминал 1 — админка
cd ~/stars-market
bun run dev

# Терминал 2 — бот
cd ~/stars-market/mini-services/tg-bot
bun run dev
```

Готово! Админка на `http://ВАШ_ХОСТ:3000`, бот работает.

---

## 🏗 Вариант B: Production (надёжно, через systemd + nginx)

### 1. Выполнить шаги 1–4 из варианта A (установка, .env, зависимости)

### 2. Собрать production-билд админки

```bash
cd ~/stars-market
bun run build
```

### 3. Настроить Nginx + HTTPS

Установить nginx и certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

Создать конфиг `/etc/nginx/sites-available/stars-market`:

```nginx
server {
    listen 80;
    server_name ВАШ-ДОМЕН;

    # Админка + Mini App (порт 3000)
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API бота (health-check, порт 3004) — опционально
    location /bot/ {
        proxy_pass http://127.0.0.1:3004/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Активировать и получить HTTPS:
```bash
sudo ln -s /etc/nginx/sites-available/stars-market /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d ВАШ-ДОМЕН   # автоматически настроит HTTPS
```

### 4. Создать systemd-сервисы (автозапуск)

**Админка** — файл `/etc/systemd/system/stars-market.service`:

```ini
[Unit]
Description=Stars Market Admin (Next.js)
After=network.target

[Service]
Type=simple
User=ВАШ_ПОЛЬЗОВАТЕЛЬ
WorkingDirectory=/home/ВАШ_ПОЛЬЗОВАТЕЛЬ/stars-market
ExecStart=/home/ВАШ_ПОЛЬЗОВАТЕЛЬ/.bun/bin/bun run start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

**Бот** — файл `/etc/systemd/system/stars-bot.service`:

```ini
[Unit]
Description=Stars Market Telegram Bot
After=network.target stars-market.service

[Service]
Type=simple
User=ВАШ_ПОЛЬЗОВАТЕЛЬ
WorkingDirectory=/home/ВАШ_ПОЛЬЗОВАТЕЛЬ/stars-market/mini-services/tg-bot
ExecStart=/home/ВАШ_ПОЛЬЗОВАТЕЛЬ/.bun/bin/bun run start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Активировать:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now stars-market
sudo systemctl enable --now stars-bot
# проверить статус:
sudo systemctl status stars-market
sudo systemctl status stars-bot
```

### 5. Настроить кнопку Mini App в боте

В [@BotFather](https://t.me/BotFather):
```
/setmenubutton
→ выбрать @zippppssbot
→ текст: 🛍 Открыть магазин
→ URL: https://ВАШ-ДОМЕН/?app=1#app
```

Готово! 🎉

---

## 📝 Команды управления (для варианта B)

```bash
# Перезапустить админку
sudo systemctl restart stars-market
sudo journalctl -u stars-market -f   # логи

# Перезапустить бота
sudo systemctl restart stars-bot
sudo journalctl -u stars-bot -f      # логи

# Обновить код после изменений
cd ~/stars-market && git pull
bun install
bun run build
sudo systemctl restart stars-market
# бот перезапускать не нужно, если код бота не менялся:
cd mini-services/tg-bot && bun install && cd ..
sudo systemctl restart stars-bot
```

---

## 🔧 Частые проблемы

### «BOT_TOKEN не настроен на сервере» при покупке
Значит Next.js не видит `.env`. Решения:
- Перезапустите сервис: `sudo systemctl restart stars-market`
- Проверьте что `BOT_TOKEN` реально в `~/stars-market/.env`

### Бот не отвечает
- Проверьте логи: `sudo journalctl -u stars-bot -f`
- Убедитесь что токен правильный (получить новый у @BotFather: `/token`)
- Проверьте что `.env` бота существует и `BOT_TOKEN` заполнен

### Mini App не открывается в Telegram
- Нужен **обязательно HTTPS** (http:// не работает в Telegram)
- URL должен быть вида `https://домен/?app=1#app`
- Проверьте что домен резолвится: `curl -I https://ВАШ-ДОМЕН`

### Заказы из бота не появляются в админке
- Оба сервиса должны использовать **одну БД** (`DATABASE_URL` указывает на один файл)
- Проверьте: `ls -la ~/stars-market/db/custom.db` — файл должен существовать

### Ошибка «createInvoiceLink» в логах
- Telegram Stars платежи требуют, чтобы бот мог отправлять инвойсы (бот должен быть создан через @BotFather, не клонирован)
- Проверьте что токен из @BotFather (не чужой)

---

## 🌐 Альтернатива: деплой на Vercel + отдельный хост для бота

Админку можно задеплоить на Vercel бесплатно:
1. Залейте репозиторий на GitHub
2. На Vercel: Import Project → выберите репозиторий
3. Environment Variables: `DATABASE_URL`, `BOT_TOKEN`
4. БД: используйте Vercel Postgres или внешний MySQL (SQLite на Vercel не работает — файловая система read-only)

Бота всё равно нужно держать на VPS/VDS (Vercel не поддерживает long-running процессы).

---

## ✅ Чек-лист готовности к продакшену

- [ ] Домен привязан, HTTPS работает (зелёный замок)
- [ ] `bun run build` проходит без ошибок
- [ ] Оба сервиса запущены через systemd (авто-рестарт)
- [ ] В `.env` админки есть `BOT_TOKEN` и `DATABASE_URL`
- [ ] В `.env` бота `WEBAPP_URL` указывает на ваш HTTPS-домен
- [ ] Кнопка меню бота настроена в @BotFather (`/setmenubutton`)
- [ ] Тестовая покупка через бота прошла (пришёл товар)
- [ ] Тестовая покупка через Mini App прошла (openInvoice)
- [ ] Бэкап БД настроен (`cp db/custom.db /backup/` по cron)

Удачного запуска! 🚀
