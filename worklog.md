# Worklog — Telegram Stars & Accounts Store

Project: Admin panel + Storefront + Telegram Mini App + Telegram Bot
Started: 2024

---
Task ID: 0
Agent: orchestrator
Task: Initial planning and project setup

Work Log:
- Explored existing Next.js 16 project structure
- Identified components: shadcn/ui complete set, Prisma, socket.io example
- Planned architecture:
  - Next.js app (port 3000): storefront + admin + mini app (single / route, mode switch)
  - Mini-service tg-bot (port 3004): Telegram bot via grammy
  - Prisma/SQLite DB
- Defined DB schema: Product, Category, Order, OrderItem, Review, Customer, StockItem, Settings

Stage Summary:
- Plan ready. Next: schema + packages + API + frontend.

---
Task ID: 8
Agent: full-stack-developer (tg-bot) + orchestrator
Task: Create Telegram bot mini-service on port 3004

Work Log:
- Created mini-services/tg-bot/ with independent bun project
- package.json with grammy + @prisma/client, dev script uses bun --hot
- Copied prisma schema, generated local PrismaClient pointing at shared SQLite db
- index.ts: Bun.serve HTTP health on :3004 + grammy bot (long-polling)
- Bot commands: /start, /help, catalog flow, stars flow, orders, support, open store
- Order creation + reservation + pay/deliver + cancel flows implemented
- Graceful shutdown handlers
- BOT_TOKEN empty in sandbox → idle mode, HTTP still alive
- Installed deps, generated client, started service; /health returns {ok:true,bot:idle}

Stage Summary:
- Bot mini-service running on :3004 (idle, ready for token)
- All storefront + admin + miniapp + API complete on Next.js :3000

---
Task ID: 9
Agent: orchestrator
Task: Verification via Agent Browser

Work Log:
- Opened http://localhost:3000 — storefront renders, HTTP 200
- Hero, catalog (12 products), categories, sort, features, reviews all rendered
- Add to cart → cart sheet → checkout → pay → "Заказ выполнен" + delivered code shown ✓
- Admin login (admin123) → dashboard with KPIs, revenue chart, top products, categories ✓
- Admin: Orders panel (filter by status, order numbers visible) ✓
- Admin: Products panel (12 items) ✓
- Mini App: hero, featured carousel, bottom nav, catalog, product detail with buy buttons ✓
- Mobile viewport 390x844 tested — nav + cart counter work ✓
- Footer sticky behavior verified (pushed down on long content, visible at bottom) ✓
- No console errors, all API calls 200
- Bot mini-service on :3004 health = {ok:true,bot:idle} ✓

Stage Summary:
- All three surfaces (storefront, admin, mini app) verified working end-to-end
- Purchase flow completes with auto-delivery
- Bot idle (no token) but HTTP healthy and ready
- Project COMPLETE

---
Task ID: 10
Agent: orchestrator
Task: Restructure site to be admin-panel only

Work Log:
- Changed page.tsx: default mode = admin; mini app accessible via /?app=1#app (for bot's web_app button)
- Removed storefront (store-app) and floating mode switcher from main route
- Updated admin-login: "Открыть Mini App" button instead of "Назад в магазин"; branded header
- Updated admin-shell: top-right "Mini App" button opens customer view in new tab
- Updated layout metadata: "Stars Market · Admin", noindex
- Created functional Settings panel (panels/settings.tsx):
  - Edit store name, tagline, support contact, currency
  - Edit Mini App URL (with auto-detected active URL + copy/open)
  - Bot username + live health status (port 3004) via /api/bot-health proxy
- Created PATCH /api/admin/settings route
- Created /api/bot-health route (server-side proxy to localhost:3004) — works without Caddy gateway
- Added StockManager component in product editor: view existing stock, add N units (custom or auto-generated codes)
- Created POST/GET /api/admin/products/[id]/stock routes
- Verified via Agent Browser: admin login, dashboard, settings (bot = "Работает"), save settings, product edit + stock add (5 units), mini app via #app, mobile responsive
- All API calls 200, no console errors

Stage Summary:
- Site is now admin-panel only (default /). Mini app for customers at /?app=1#app
- Full control: dashboard, products+stock, orders, reviews, customers, settings (store/bot/miniapp)
- Bot health monitoring integrated

---
Task ID: 11
Agent: orchestrator
Task: Real Telegram Stars payments + new categories in Mini App

Work Log:
- Added BOT_TOKEN to main .env (for Bot API createInvoiceLink from Next.js)
- Add-on seed: 3 new categories (tg-accounts, boost, tg-channels) + 15 products
  - Telegram аккаунты (4 acc products)
  - Накрутка (7 service products: подписчики/просмотры/реакции, no stock)
  - Telegram каналы (4 channel products, 1 stock each)
- Updated order logic: services (type=service) skip stock check/reserve; delivered = "в работе"
- Updated /api/orders, /api/orders/[id], /api/admin/orders/[id] for service handling
- Created POST /api/stars-invoice: creates pending order + calls Bot API createInvoiceLink with XTR currency, returns invoiceLink + slug
- Conversion rate: 1 Star = 2 RUB (STARS_PER_RUB=0.5)
- Bot (grammy) rewritten:
  - createOrderFromProduct now sends Stars invoice via ctx.replyWithInvoice (currency XTR)
  - Added bot.on("pre_checkout_query") → answerPreCheckoutQuery(true)
  - Added bot.on("message:successful_payment") → deliverOrder + sendDeliveryMessage
  - deliverOrder() shared core: handles services + stock items
- Mini App updates:
  - Added view "categories" with full category list (incl. new ones)
  - Category chips at top of catalog view
  - Categories grid on home screen
  - Quick actions: Каталог, Звёзды, Накрутка, Корзина
  - Replaced simulated checkout with real Stars payment: POST /api/stars-invoice → Telegram.WebApp.openInvoice(invoiceLink)
  - payWithStars() handles paid/cancelled/failed; fetches order after paid
  - Product cards show price in RUB + Stars (⭐)
  - Service products: buy button enabled even with inStock=0
- Fixed bug: customer.upsert used non-existent `customerName` field (→ firstName)
- Verified: API stars-invoice returns valid t.me/$ link; admin shows stars orders; mini app categories render; product buy button works
- Bot polling active @zippppssbot; no errors

Stage Summary:
- Real Telegram Stars payments end-to-end (bot invoice + Mini App openInvoice)
- 7 categories now in Mini App: Stars, Premium, Виртуальные номера, Подарки, Telegram аккаунты, Накрутка, Telegram каналы
- Service products (накрутка) handled without stock — "в работе" delivery
- Conversion 1 Star = 2 RUB (configurable in code)

---
Task ID: 12
Agent: orchestrator
Task: Prepare deployment package for user's own host

Work Log:
- Restored missing .env files (bot .env was lost) — both services running again
- Created DEPLOY.md — full deployment guide (2 variants: quick dev + production)
- Created deploy/ folder with ready-to-use configs:
  - deploy/nginx/stars-market.conf (nginx reverse proxy :80 → :3000 + /bot/ → :3004)
  - deploy/systemd/stars-market.service (Next.js production autostart)
  - deploy/systemd/stars-bot.service (grammy bot autostart)
  - deploy/scripts/install.sh (one-command installer: bun + nginx + certbot + systemd + HTTPS)
  - deploy/scripts/status.sh (health-check both services + logs)
- Smoke test: admin 200, mini app 200, bot running, 7 categories, stars-invoice returns valid t.me/$ link

Stage Summary:
- User can deploy to own host via: copy code → bash deploy/scripts/install.sh → configure domain
- All configs templatized with ВАШ-ДОМЕН / ВАШ_ПОЛЬЗОВАТЕЛЬ placeholders
- Production path: systemd + nginx + Let's Encrypt HTTPS

---
Task ID: 13
Agent: orchestrator
Task: Prepare Railway deployment

Work Log:
- Added DATABASE_PROVIDER support attempt → reverted (Prisma doesn't allow env() in provider)
- Solution: schema stays "sqlite" locally; Railway build hook sed-swaps to "postgresql" at build time
- Created deploy/railway/build-admin.sh: swaps provider → postgresql, prisma generate, db push, seed (idempotent), next build
- Created deploy/railway/build-bot.sh: swaps provider → postgresql, prisma generate
- Created railway.admin.toml + railway.bot.toml (Railway service configs)
- Made seed.ts + seed-additional.ts idempotent (skip if already seeded) — safe for Railway redeploy
- Updated package.json: start command simplified (no tee, works with Railway PORT env)
- Verified .gitignore excludes .env, db/custom.db, node_modules, logs
- Created .env.example as template
- Created RAILWAY.md — full step-by-step Railway deploy guide
- Kept BOT_TOKEN in local .env only (NOT hardcoded in code — set as Railway Variable)

Stage Summary:
- 2 Railway services: admin (Next.js) + bot (grammy), shared PostgreSQL plugin
- Build hooks auto-switch SQLite→PostgreSQL, auto-seed on first deploy
- Free Railway domain with HTTPS (for Mini App WEBAPP_URL)
- User keeps BOT_TOKEN as env var, not in code
