// Telegram Bot mini-service for the Stars Market store.
// Runs an HTTP health endpoint on port 3004 + a grammy bot (long-polling by default).

import { createServer } from "http";
import { Bot, InlineKeyboard, Keyboard } from "grammy";
import { db } from "./db";
import { getLoginCode } from "./mtproto";
import { createOrder as smmCreateOrder, SMM_SERVICES, calculatePrice, getBalance, getOrderStatus } from "./smm";
import {
  formatPrice,
  formatDate,
  orderStatusLabel,
  genOrderNumber,
} from "./helpers";

// === SMS NUMBERS (встроено напрямую, без отдельного файла) ===
const SMS_API = "https://backend.smsfast.vip/stubs/handler_api.php";
const SMS_KEY = process.env.SMS_API_KEY || "";
if (!SMS_KEY) console.warn("[tg-bot] WARNING: SMS_API_KEY env var not set — SMS number ordering will fail");

async function smsOrderNumber(service: string, country: number): Promise<{ id: number; phone: string }> {
  const url = `${SMS_API}?api_key=${SMS_KEY}&action=getNumber&service=${service}&country=${country}`;
  console.log("[SMS] orderNumber:", { service, country });
  const res = await fetch(url);
  const text = await res.text();
  console.log("[SMS] response:", text);
  if (text.startsWith("ACCESS_NUMBER:")) {
    const parts = text.split(":");
    const id = parseInt(parts[1]);
    if (!Number.isFinite(id) || !parts[2]) {
      throw new Error("Некорректный ответ сервиса номеров: " + text);
    }
    return { id, phone: "+" + parts[2] };
  }
  if (text === "NO_NUMBERS") throw new Error("Нет доступных номеров для этой страны. Попробуйте другую.");
  if (text === "NO_BALANCE") throw new Error("Недостаточно средств на сервисе номеров.");
  throw new Error("Ошибка: " + text);
}

async function smsGetStatus(id: number): Promise<{ status: string; code?: string }> {
  const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getStatus&id=${id}`);
  const text = await res.text();
  if (text.startsWith("STATUS_OK:")) return { status: "ok", code: text.split(":")[1] };
  if (text === "STATUS_WAIT_CODE") return { status: "wait" };
  if (text === "STATUS_CANCEL") return { status: "cancel" };
  return { status: text };
}

async function smsSetStatus(id: number, status: number): Promise<string> {
  const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=setStatus&id=${id}&status=${status}`);
  return await res.text();
}
// === END SMS NUMBERS ===

const PORT = Number(process.env.PORT) || 3004;
const BOT_TOKEN = process.env.BOT_TOKEN?.trim() || "";
const WEBAPP_URL = process.env.WEBAPP_URL?.trim() || "";

let botRunning = false;
let bot: Bot | null = null;

// Pending uploads for admin mode: userId → { productId, productTitle }
const pendingUploads = new Map<string, { productId: string; productTitle: string }>();

// Pending SMS orders: orderId → { activationId, phone, attempts, chatId }
const pendingSMSOrders = new Map<string, { activationId: number; phone: string; attempts: number; chatId: number; tgId: string; country: number }>();

// Pending link requests for SMM orders: userId → { orderId, productTitle, smmServiceKey, smmServiceId, quantity }
const pendingLinkRequests = new Map<string, { orderId: string; productTitle: string; smmServiceKey: string; smmServiceId: string; quantity: number }>();

// Pending session uploads: userId → { productId, phone, password, twoFA }
const pendingSessionUploads = new Map<string, { productId: string; phone: string; password: string; twoFA: string }>();

// ---------- HTTP health server (Node.js http — работает везде) ----------
const httpServer = createServer((req, res) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      bot: botRunning ? "running" : "idle",
    }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});
httpServer.listen(PORT, () => {
  console.log(`[tg-bot] HTTP health server listening on :${PORT}`);
});

// ---------- Helpers for keyboards ----------
function mainMenuKeyboard() {
  const kb = new Keyboard()
    .text("🛍 Каталог")
    .text("⭐ Купить Звёзды")
    .row()
    .text("📦 Мои заказы")
    .text("⭐ Отзывы")
    .row()
    .text("💬 Поддержка")
    .text("🌐 Открыть магазин")
    .resized();
  return kb;
}

function mainMenuInline() {
  const kb = new InlineKeyboard()
    .text("🛍 Каталог", "catalog")
    .text("⭐ Звёзды", "stars")
    .row()
    .text("📦 Мои заказы", "orders")
    .text("⭐ Отзывы", "reviews")
    .row()
    .text("💬 Поддержка", "support")
    .text("🌐 Открыть магазин", "open_store")
    .row()
    .text("📋 Правовая информация", "legal");
  return kb;
}

async function getSettings() {
  let s = await db.settings.findUnique({ where: { id: "singleton" } });
  if (!s) {
    s = await db.settings.create({ data: { id: "singleton" } });
  }
  return s;
}

function stars(n: number): string {
  const full = Math.floor(n);
  const half = n - full >= 0.5;
  return "⭐".repeat(full) + (half ? "✨" : "");
}

// Escape Markdown special characters in user-supplied strings before interpolating
// into a Markdown message. Prevents injection / broken formatting from product titles etc.
function escapeMd(s: string): string {
  return String(s ?? "").replace(/([_*`\[\]()~>#+\-=|{}.!\\])/g, "\\$1");
}

// ---------- Bot setup ----------
async function setupBot() {
  // Guard against double invocation — multiple setupBot() calls would create duplicate
  // bot instances and start two long-polling loops against the same token.
  if (bot) return;

  if (!BOT_TOKEN) {
    console.log(
      "BOT_TOKEN not set — bot in idle mode. HTTP health on :3004 still running."
    );
    return;
  }

  bot = new Bot(BOT_TOKEN);

  bot.catch((err) => {
    console.error("[bot] error:", err.error);
    console.error("[bot] update:", JSON.stringify(err.ctx?.update ?? null).slice(0, 500));
  });

  // /start
  bot.command("start", async (ctx) => {
    const s = await getSettings();
    const text =
      `👋 Добро пожаловать в *${s.storeName}*!\n\n` +
      `${s.tagline}\n\n` +
      `Выберите действие из меню ниже 👇`;
    await ctx.reply(text, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  });

  // /help
  bot.command("help", async (ctx) => {
    const text =
      `*Справка по командам*\n\n` +
      `/start — Главное меню\n` +
      `/help — Список команд\n\n` +
      `*Кнопки меню:*\n` +
      `🛍 Каталог — категории и товары\n` +
      `⭐ Купить Звёзды — быстрый список звёзд\n` +
      `📦 Мои заказы — последние заказы\n` +
      `💬 Поддержка — контакт поддержки\n` +
      `🌐 Открыть магазин — открыть веб-приложение`;
    await ctx.reply(text, {
      parse_mode: "Markdown",
      reply_markup: mainMenuKeyboard(),
    });
  });

  // ============ АДМИН-КОМАНДЫ ============
  // Доступ только для ADMIN_TG_ID (ваш Telegram ID)
  
  // /admin — главное меню админа
  bot.command("admin", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id);
    if (!adminId || userId !== adminId) {
      await ctx.reply("⛔ У вас нет доступа к админ-панели.");
      return;
    }
    await showAdminMenu(ctx);
  });

  // /addstock <productId> — режим добавления аккаунтов
  bot.command("addstock", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id);
    if (!adminId || userId !== adminId) {
      await ctx.reply("⛔ Доступ запрещён.");
      return;
    }
    const args = ctx.match?.trim().split(/\s+/) || [];
    if (args.length === 0) {
      await ctx.reply(
        "📝 *Добавление аккаунтов на склад\n\n*" +
        "Использование:\n" +
        "`/addstock PRODUCT_ID`\n\n" +
        "После этого отправьте текст с аккаунтами (по одному на строку).\n\n" +
        "Чтобы узнать PRODUCT_ID — используйте `/products`",
        { parse_mode: "Markdown" }
      );
      return;
    }
    const productId = args[0];
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) {
      await ctx.reply("❌ Товар не найден. Используйте `/products` для списка ID.", { parse_mode: "Markdown" });
      return;
    }
    // Сохраняем режим — ждём следующее сообщение с аккаунтами
    pendingUploads.set(userId, { productId, productTitle: product.title });
    await ctx.reply(
      `📝 *Режим загрузки аккаунтов*\n\n` +
      `Товар: *${product.title}*\n` +
      `ID: \`${productId}\`\n\n` +
      `Отправьте следующее сообщение с аккаунтами.\n` +
      `Формат — по одному на строку:\n\n` +
      `_login:pass\nlogin:pass\nlogin:pass_\n\n` +
      `Или пришлите /cancel для отмены.`,
      { parse_mode: "Markdown" }
    );
  });

  // /uploadsession <productId> <phone> [password] [2FA] — загрузка сессии аккаунта
  bot.command("uploadsession", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id);
    if (!adminId || userId !== adminId) {
      await ctx.reply("⛔ Доступ запрещён.");
      return;
    }
    const args = ctx.match?.trim().split(/\s+/) || [];
    if (args.length < 2) {
      await ctx.reply(
        "📝 *Загрузка аккаунта с сессией*\n\n" +
        "Формат:\n" +
        "`/uploadsession PRODUCT_ID PHONE [PASSWORD] [2FA]`\n\n" +
        "Пример:\n" +
        "`/uploadsession abc123 +79123456789 MyPass123 TwoFA456`\n\n" +
        "После этого пришлите .session файл как документ.",
        { parse_mode: "Markdown" }
      );
      return;
    }
    const productId = args[0];
    const phone = args[1];
    const password = args[2] || "";
    const twoFA = args[3] || "";
    
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) {
      await ctx.reply("❌ Товар не найден. Используйте `/products`.", { parse_mode: "Markdown" });
      return;
    }
    
    pendingSessionUploads.set(userId, { productId, phone, password, twoFA });
    await ctx.reply(
      `📱 *Загрузка аккаунта*\n\n` +
      `Товар: *${product.title}*\n` +
      `Телефон: ${phone}\n` +
      `Пароль: ${password ? "✓" : "нет"}\n` +
      `2FA: ${twoFA ? "✓" : "нет"}\n\n` +
      `Теперь пришлите .session файл как документ.\n` +
      `Или /cancel для отмены.`,
      { parse_mode: "Markdown" }
    );
  });

  // Обработка документа (.session файла)
  bot.on("message:document", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id);
    
    if (!adminId || userId !== adminId || !pendingSessionUploads.has(userId)) {
      return;
    }
    
    const upload = pendingSessionUploads.get(userId)!;
    const doc = ctx.message.document;
    const fileName = doc.file_name || "unknown";
    
    if (!fileName.endsWith(".session") && !fileName.endsWith(".txt")) {
      await ctx.reply("❌ Ожидается .session файл. Попробуйте ещё раз или /cancel");
      return;
    }
    
    try {
      // Скачиваем файл
      const fileUrl = await ctx.api.getFile(doc.file_id);
      const fileResp = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${fileUrl.file_path}`);
      const sessionData = await fileResp.text();
      
      if (sessionData.length < 50) {
        await ctx.reply("❌ Session файл слишком короткий. Проверьте содержимое.");
        return;
      }
      
      // Создаём StockItem с данными аккаунта (sessionData хранится в sessionFile)
      const stockItem = await db.stockItem.create({
        data: {
          productId: upload.productId,
          content: `phone: ${upload.phone}\npassword: ${upload.password || "нет"}\n2FA: ${upload.twoFA || "нет"}\nsession: stored-in-db`,
          status: "available",
          phone: upload.phone,
          password: upload.password || null,
          twoFA: upload.twoFA || null,
          sessionFile: sessionData.trim(), // StringSession хранится прямо в БД
        },
      });
      
      pendingSessionUploads.delete(userId);
      
      const totalStock = await db.stockItem.count({
        where: { productId: upload.productId, status: "available" },
      });
      
      await ctx.reply(
        `✅ *Аккаунт загружен!*\n\n` +
        `Товар: ${upload.productId}\n` +
        `Телефон: ${upload.phone}\n` +
        `Session: ${fileName}\n` +
        `ID склада: ${stockItem.id}\n\n` +
        `Всего на складе: ${totalStock}\n\n` +
        `Используйте /uploadsession для ещё одного аккаунта.`,
        { parse_mode: "Markdown" }
      );
    } catch (e: any) {
      console.error("Session upload error:", e);
      await ctx.reply(`❌ Ошибка: ${e.message}`);
    }
  });

  // /products — список всех товаров с ID
  bot.command("products", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id);
    if (!adminId || userId !== adminId) {
      await ctx.reply("⛔ Доступ запрещён.");
      return;
    }
    const products = await db.product.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      include: { category: true },
    });
    let text = "📋 *Список товаров:*\n\n";
    for (const p of products) {
      const stock = p.type === "service" ? "услуга" : await db.stockItem.count({ where: { productId: p.id, status: "available" } });
      text += `*${p.title}*\n`;
      text += `  ID: \`${p.id}\`\n`;
      text += `  Цена: ${formatPrice(p.price)} | Склад: ${stock}\n\n`;
    }
    text += "\nИспользуйте: `/addstock ID` для загрузки аккаунтов";
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  // /stock — остатки на складе
  bot.command("stock", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id);
    if (!adminId || userId !== adminId) {
      await ctx.reply("⛔ Доступ запрещён.");
      return;
    }
    const products = await db.product.findMany({
      where: { active: true, type: { not: "service" } },
      orderBy: { createdAt: "asc" },
    });
    let text = "📦 *Остатки на складе:*\n\n";
    let totalAvailable = 0;
    for (const p of products) {
      const available = await db.stockItem.count({ where: { productId: p.id, status: "available" } });
      const sold = await db.stockItem.count({ where: { productId: p.id, status: "sold" } });
      totalAvailable += available;
      const status = available === 0 ? "🔴" : available <= 3 ? "🟡" : "🟢";
      text += `${status} *${p.title}*\n  В наличии: ${available} | Продано: ${sold}\n`;
    }
    text += `\n*Всего на складе: ${totalAvailable}*`;
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  // /smmstatus — статус SMM (для админа)
  bot.command("smmstatus", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id);
    if (!adminId || userId !== adminId) {
      await ctx.reply("⛔ Доступ запрещён.");
      return;
    }
    const balance = await getBalance();
    let text = "📊 *SMM Статус (twiboost)*\n\n";
    if ("error" in balance) {
      text += `❌ Ошибка: ${balance.error}`;
    } else {
      text += `💰 Баланс: *${balance.balance} ${balance.currency}*\n`;
    }
    // Считаем заказы со SMM
    const orders = await db.order.findMany({
      where: { payMethod: "stars", items: { some: { delivered: { contains: "SMM Order" } } } },
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { items: true },
    });
    text += `\n📋 *Последние SMM-заказы (${orders.length}):*\n`;
    for (const o of orders.slice(0, 5)) {
      const item = o.items[0];
      const smmMatch = item?.delivered?.match(/SMM Order: #(\d+)/);
      const smmId = smmMatch ? parseInt(smmMatch[1]) : null;
      let status = "?";
      if (smmId) {
        const st = await getOrderStatus(smmId);
        if (!("error" in st)) status = st.status;
      }
      text += `• ${o.number} → ${status}\n`;
    }
    await ctx.reply(text, { parse_mode: "Markdown" });
  });

  // /legal — юридические документы
  bot.command("legal", async (ctx) => {
    const WEBAPP = process.env.WEBAPP_URL?.trim() || "";
    const domain = WEBAPP.split("?")[0].replace(/#.*$/, "");
    const kb = new InlineKeyboard()
      .url("🔒 Политика конфиденциальности", domain + "/privacy").row()
      .url("📄 Пользовательское соглашение", domain + "/terms").row()
      .url("💰 Цены и тарифы", domain + "/pricing").row()
      .url("📞 Контакты поддержки", domain + "/contacts").row()
      .url("⭐ Отзывы покупателей", domain + "/reviews");
    await ctx.reply(
      "📋 *Юридическая информация*\n\nВыберите документ для просмотра:",
      { parse_mode: "Markdown", reply_markup: kb }
    );
  });

  // /cancel — отмена режима загрузки
  bot.command("cancel", async (ctx) => {
    const userId = String(ctx.from?.id);
    let cancelled = false;
    if (pendingUploads.has(userId)) {
      pendingUploads.delete(userId);
      cancelled = true;
    }
    if (pendingSessionUploads.has(userId)) {
      pendingSessionUploads.delete(userId);
      cancelled = true;
    }
    if (cancelled) {
      await ctx.reply("✅ Режим загрузки отменён.");
    }
  });

  // ============ КОНЕЦ АДМИН-КОМАНД ============

  // Text-based menu (hears)
  bot.hears("🛍 Каталог", (ctx) => showCategories(ctx));
  bot.hears("⭐ Купить Звёзды", (ctx) => showStars(ctx));
  bot.hears("📦 Мои заказы", (ctx) => showOrders(ctx));
  bot.hears("💬 Поддержка", (ctx) => showSupport(ctx));
  bot.hears("🌐 Открыть магазин", (ctx) => openStore(ctx));
  bot.hears("⭐ Отзывы", (ctx) => showReviews(ctx));

  // ---------- Inline callbacks ----------
  bot.callbackQuery("catalog", async (ctx) => {
    await showCategories(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("stars", async (ctx) => {
    await showStars(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("orders", async (ctx) => {
    await showOrders(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("support", async (ctx) => {
    await showSupport(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("open_store", async (ctx) => {
    await openStore(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("reviews", async (ctx) => {
    await showReviews(ctx);
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery("back_to_catalog", async (ctx) => {
    await showCategories(ctx);
    await ctx.answerCallbackQuery();
  });

  // Category click → show products in that category
  bot.callbackQuery(/^cat:(.+)$/, async (ctx) => {
    const categoryId = ctx.match[1];
    await showProductsInCategory(ctx, categoryId);
    await ctx.answerCallbackQuery();
  });

  // Back from products to categories list
  bot.callbackQuery("back_to_cats", async (ctx) => {
    await showCategories(ctx);
    await ctx.answerCallbackQuery();
  });

  // Product buy button → create order
  bot.callbackQuery(/^buy:(.+)$/, async (ctx) => {
    const productId = ctx.match[1];
    await createOrderFromProduct(ctx, productId);
    await ctx.answerCallbackQuery();
  });

  // NOTE: The "pay:" callback that bypassed payment has been REMOVED.
  // Users must pay via the Stars invoice sent at order creation. If they lost it,
  // they cancel and re-order.

  // Cancel order
  bot.callbackQuery(/^cancel_order:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    await cancelOrder(ctx, orderId);
    await ctx.answerCallbackQuery();
  });

  // Noop (disabled buttons)
  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Товара нет в наличии" });
  });

  // ---------- Правовая информация ----------
  bot.callbackQuery("legal", async (ctx) => {
    const WEBAPP = process.env.WEBAPP_URL?.trim() || "";
    const domain = WEBAPP.split("?")[0].replace(/#.*$/, "");
    const kb = new InlineKeyboard()
      .url("🔒 Политика конфиденциальности", domain + "/privacy").row()
      .url("📄 Пользовательское соглашение", domain + "/terms").row()
      .url("💰 Цены и тарифы", domain + "/pricing").row()
      .url("📞 Контакты поддержки", domain + "/contacts").row()
      .url("⭐ Отзывы покупателей", domain + "/reviews");
    await ctx.reply(
      "📋 *Правовая информация*\n\nВыберите документ для просмотра:",
      { parse_mode: "Markdown", reply_markup: kb }
    );
    await ctx.answerCallbackQuery();
  });

  // ---------- Смена виртуального номера ----------
  bot.callbackQuery(/^chgnum:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const smsOrder = pendingSMSOrders.get(orderId);
    
    if (!smsOrder) {
      // No active SMS order to change — likely already completed/cancelled.
      await ctx.answerCallbackQuery({ text: "⚠️ Активный номер не найден. Заказ уже завершён или отменён." });
      return;
    }
    
    // Capture country BEFORE deleting from the map (default to 115/США if missing).
    const country = smsOrder.country ?? 115;
    
    // Отменяем старый номер
    try { await smsSetStatus(smsOrder.activationId, 8); } catch {}
    pendingSMSOrders.delete(orderId);
    
    await ctx.answerCallbackQuery({ text: "🔄 Заказываю новый номер..." });
    
    // Заказываем новый номер
    try {
      const result = await smsOrderNumber("tg", country);
      pendingSMSOrders.set(orderId, {
        activationId: result.id,
        phone: result.phone,
        attempts: 0,
        chatId: ctx.chat.id,
        tgId: String(ctx.from?.id),
        country: country,
      });
      
      // Обновляем заказ
      await db.orderItem.updateMany({
        where: { orderId },
        data: { delivered: `📱 Номер: ${result.phone}\n🔧 ID: ${result.id}\n⏳ Ожидание SMS...` },
      });
      
      const kb = new InlineKeyboard()
        .text("🔄 Сменить номер", `chgnum:${orderId}`)
        .row()
        .text("❌ Отменить", `cancelnum:${orderId}`);
      
      await ctx.reply(
        `📱 *Новый номер заказан!*\n\n` +
        `📞 Номер: *${result.phone}*\n` +
        `⏳ Проверка SMS каждые 10 секунд...`,
        { parse_mode: "Markdown", reply_markup: kb }
      );
      
      // Запускаем polling
      pollSMS(orderId, ctx);
    } catch (e: any) {
      await ctx.reply(`❌ Ошибка: ${e.message}`);
    }
  });

  // ---------- Отмена виртуального номера ----------
  bot.callbackQuery(/^cancelnum:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const smsOrder = pendingSMSOrders.get(orderId);
    
    if (smsOrder) {
      // Пробуем отменить (status=8), если не выйдет — завершаем (status=6)
      try {
        const cancelResult = await smsSetStatus(smsOrder.activationId, 8);
        console.log("[SMS] cancel result:", cancelResult);
        if (cancelResult.includes("DENIED") || cancelResult.includes("ERROR")) {
          // Если отмена не удалась — завершаем
          await smsSetStatus(smsOrder.activationId, 6);
          console.log("[SMS] fallback: completed instead of cancelled");
        }
      } catch (e: any) {
        console.error("[SMS] cancel error:", e.message);
        // Пробуем завершить
        try { await smsSetStatus(smsOrder.activationId, 6); } catch {}
      }
      pendingSMSOrders.delete(orderId);
    }
    
    // Отменяем заказ
    await db.order.update({ where: { id: orderId }, data: { status: "cancelled" } });
    
    await ctx.answerCallbackQuery({ text: "❌ Отменено" });
    await ctx.reply(
      "✅ Заказ отменён. Номер возвращён на сервис.\n\n" +
      "Если возникли вопросы — нажмите 💬 Поддержка.",
      { parse_mode: "Markdown", reply_markup: mainMenuInline() }
    );
  });

  // ---------- Получение кода входа для аккаунтов ----------
  bot.callbackQuery(/^getcode:(.+)$/, async (ctx) => {
    const itemId = ctx.match[1];
    try {
      // Находим orderItem и связанный StockItem
      const orderItem = await db.orderItem.findUnique({
        where: { id: itemId },
      });
      if (!orderItem || !orderItem.delivered) {
        await ctx.answerCallbackQuery({ text: "Заказ не найден" });
        return;
      }
      
      // Получаем StockItem связанный с этим orderItem
      // Ищем по phone в delivered
      const phoneMatch = orderItem.delivered.match(/phone: (.+)/);
      if (!phoneMatch) {
        await ctx.answerCallbackQuery({ text: "Данные аккаунта не найдены" });
        return;
      }
      const phone = phoneMatch[1].trim();
      
      // Ищем StockItem по phone
      const stockItem = await db.stockItem.findFirst({
        where: { phone },
      });
      if (!stockItem || !stockItem.sessionFile) {
        await ctx.answerCallbackQuery({ text: "Session не найдена" });
        return;
      }
      
      await ctx.answerCallbackQuery({ text: "⏳ Получаю код..." });
      
      // Запрашиваем код у MTProto модуля (sessionFile содержит StringSession)
      const result = await getLoginCode(stockItem.sessionFile, stockItem.id, 600);
      
      if (result.code) {
        const time = result.receivedAt ? result.receivedAt.toLocaleTimeString("ru-RU") : "";
        await ctx.reply(
          `📱 *Код входа получен!*\n\n` +
          `🔑 *Код:* \`${result.code}\`\n` +
          `⏰ Получен: ${time}\n\n` +
          `Введите этот код в Telegram для входа в аккаунт.\n\n` +
          `⚠️ Код действителен ограниченное время.\n` +
          `Если не подошёл — нажмите «📱 Получить код» ещё раз.`,
          { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("📱 Получить код заново", `getcode:${itemId}`).row().text("💬 Поддержка", "support") }
        );
      } else {
        await ctx.reply(
          `⚠️ *Не удалось получить код*\n\n` +
          `Причина: ${result.error || "неизвестная"}\n\n` +
          `Возможные причины:\n` +
          `• Telegram ещё не прислал SMS (подождите 30 сек и попробуйте снова)\n` +
          `• Session файл недействителен\n` +
          `• Нет доступа к аккаунту\n\n` +
          `Попробуйте ещё раз через 30 секунд.`,
          { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔄 Попробовать снова", `getcode:${itemId}`).row().text("💬 Поддержка", "support") }
        );
      }
    } catch (e: any) {
      console.error("getcode error:", e);
      await ctx.answerCallbackQuery({ text: "Ошибка: " + e.message.slice(0, 100) });
    }
  });

  // ---------- Admin upload handler + SMM link handler ----------
  bot.on("message:text", async (ctx) => {
    const userId = String(ctx.from?.id);
    
    // 1. Проверяем запрос ссылки для накрутки (для любого пользователя)
    if (pendingLinkRequests.has(userId)) {
      const req = pendingLinkRequests.get(userId)!;
      const link = ctx.message.text.trim();
      
      if (link.startsWith("/") || link.length < 5) {
        return; // команда, пропускаем
      }
      
      // Простая валидация ссылки
      if (!link.match(/^(https?:\/\/t\.me\/|@)/i)) {
        await ctx.reply(
          "❌ Неверный формат ссылки.\n\n" +
          "Пришлите ссылку в формате:\n" +
          "• @username канала\n" +
          "• https://t.me/username\n" +
          "• https://t.me/username/123 (для поста)",
          { parse_mode: "Markdown" }
        );
        return;
      }
      
      pendingLinkRequests.delete(userId);
      await ctx.reply("⏳ Создаю заказ на накрутку...");
      
      // Заказываем через SMM API
      const result = await smmCreateOrder(req.smmServiceId, link, req.quantity);
      
      if ("error" in result) {
        await ctx.reply(
          `❌ *Ошибка создания заказа*\n\nПричина: ${result.error}\n\nОбратитесь в поддержку с номером заказа.`,
          { parse_mode: "Markdown", reply_markup: mainMenuInline() }
        );
      } else {
        // Обновляем заказ — записываем SMM order ID
        await db.orderItem.updateMany({
          where: { orderId: req.orderId },
          data: { delivered: `🚀 Заказ запущен!\nSMM Order: #${result.orderId}\nУслуга: ${req.productTitle}\nКоличество: ${req.quantity}\nСсылка: ${link}\nСтатус: In progress` },
        });
        
        // SMM order was created successfully — now (and only now) mark the order as completed.
        // (Earlier the order was set to "paid" while waiting for the buyer's link.)
        await db.order.update({ where: { id: req.orderId }, data: { status: "completed" } });
        
        await ctx.reply(
          `✅ *Заказ на накрутку запущен!*\n\n` +
          `📋 Номер заказа: *${req.orderId.slice(-8).toUpperCase()}*\n` +
          `🔢 SMM Order: #${result.orderId}\n` +
          `📦 Услуга: ${req.productTitle}\n` +
          `📊 Количество: ${req.quantity}\n` +
          `🔗 Ссылка: ${link}\n\n` +
          `⏰ Накрутка выполняется в фоне. Обычно занимает от 30 минут до 24 часов.\n\n` +
          `Проверить статус: /orders`,
          { parse_mode: "Markdown", reply_markup: mainMenuInline() }
        );
        
        // Уведомление админу
        const adminId = process.env.ADMIN_TG_ID?.trim();
        if (adminId) {
          try {
            await ctx.api.sendMessage(adminId,
              `🔔 *Новый заказ на накрутку*\n\n` +
              `👤 Клиент: ${ctx.from?.first_name || "Unknown"} (${userId})\n` +
              `📋 Заказ: ${req.orderId.slice(-8).toUpperCase()}\n` +
              `🔢 SMM: #${result.orderId}\n` +
              `📦 Услуга: ${req.productTitle}\n` +
              `📊 Кол-во: ${req.quantity}\n` +
              `🔗 Ссылка: ${link}`,
              { parse_mode: "Markdown" }
            );
          } catch (e) { console.error("Admin notify error:", e); }
        }
      }
      return;
    }
    
    // 2. Admin upload handler
    const adminId = process.env.ADMIN_TG_ID?.trim();
    if (!adminId || userId !== adminId || !pendingUploads.has(userId)) {
      return; // не админ или не в режиме загрузки — пропускаем
    }
    
    const upload = pendingUploads.get(userId)!;
    const text = ctx.message.text;
    
    // Пропускаем команды
    if (text.startsWith("/")) {
      return;
    }
    
    // Парсим аккаунты — по одному на строку
    const lines = text.split("\n").map((l: string) => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      await ctx.reply("❌ Не найдено ни одной строки. Отправьте аккаунты по одному на строку.");
      return;
    }
    
    // Добавляем в БД
    let added = 0;
    for (const line of lines) {
      try {
        await db.stockItem.create({
          data: {
            productId: upload.productId,
            content: line,
            status: "available",
          },
        });
        added++;
      } catch (e) {
        console.error("StockItem create error:", e);
      }
    }
    
    // Сбрасываем режим
    pendingUploads.delete(userId);
    
    const totalStock = await db.stockItem.count({
      where: { productId: upload.productId, status: "available" },
    });
    
    await ctx.reply(
      `✅ Готово!\n\nДобавлено: ${added} аккаунтов\nТовар: ${upload.productTitle}\nВсего на складе: ${totalStock}\n\nИспользуйте /addstock ${upload.productId} для ещё одной загрузки`,
      { parse_mode: "Markdown" }
    );
  });

  // ---------- Telegram Stars payment handlers ----------
  // pre_checkout_query: Telegram asks us to confirm the invoice can be paid
  // ОТВЕЧАЕМ ПРЯМЫМ FETCH — grammy answerPreCheckoutQuery может зависать
  bot.on("pre_checkout_query", async (ctx) => {
    const botToken = process.env.BOT_TOKEN!;
    const preCheckoutId = ctx.preCheckoutQuery.id;
    try {
      const payload = ctx.preCheckoutQuery.invoice_payload;
      const parsed = JSON.parse(payload);
      const order = await db.order.findUnique({
        where: { id: parsed.orderId },
        include: { items: true },
      });
      const ok = !!(order && order.status === "pending");
      const error = ok ? undefined : "Заказ уже обработан или отменён";
      
      // Прямой fetch к Telegram API
      await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pre_checkout_query_id: preCheckoutId, ok, error }),
      });
    } catch (e: any) {
      console.error("[pre_checkout] error:", e);
      // Fail-closed: do NOT confirm a charge we couldn't validate. Telegram will refund the user.
      await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pre_checkout_query_id: preCheckoutId,
          ok: false,
          error_message: "Не удалось обработать заказ. Попробуйте позже или обратитесь в поддержку.",
        }),
      });
    }
  });

  // successful_payment: user paid with Stars → deliver goods
  bot.on("message:successful_payment", async (ctx) => {
    try {
      const sp = ctx.message.successful_payment;
      const parsed = JSON.parse(sp.invoice_payload);
      const order = await db.order.findUnique({
        where: { id: parsed.orderId },
        include: { items: true, customer: true },
      });
      if (!order) {
        console.error("[tg-bot] successful_payment: order not found", parsed);
        return;
      }
      if (order.status === "completed") {
        await ctx.reply(`✅ Этот заказ (${order.number}) уже оплачен и доставлен.`);
        return;
      }

      const tgId = String(ctx.from?.id ?? "");
      const firstItem = order.items[0];
      if (!firstItem) {
        console.error("[tg-bot] successful_payment: order has no items", order.id);
        await ctx.reply("⚠️ Заказ не содержит товаров. Обратитесь в поддержку.");
        return;
      }
      // Include category so we can detect product type robustly (slug keywords alone are fragile).
      const product = await db.product.findUnique({
        where: { id: firstItem.productId },
        include: { category: true },
      });
      
      if (!product) {
        await ctx.reply("⚠️ Товар не найден. Обратитесь в поддержку.");
        return;
      }

      // Определяем тип товара по категории + slug + названию (надёжнее чем только slug)
      const catSlug = product.category?.slug ?? "";
      const titleLower = product.title.toLowerCase();
      const slugLower = product.slug.toLowerCase();
      const isVirtualNumber =
        catSlug === "virtual-numbers" ||
        slugLower.includes("nomer") || slugLower.includes("number") || slugLower.includes("virtual") || slugLower.includes("sms") ||
        titleLower.includes("виртуальн") || titleLower.includes("номер");
      const isBoost =
        product.type === "service" &&
        (catSlug === "boost" || catSlug === "nakrutka" ||
         slugLower.includes("nakrutka") || slugLower.includes("подписчик") || slugLower.includes("просмотр") || slugLower.includes("реакц"));

      if (isVirtualNumber) {
        // === ВИРТУАЛЬНЫЙ НОМЕР ===
        let country = 115;
        const countryMatch = product.longDesc?.match(/Страна: ID (\d+)/);
        if (countryMatch) {
          const parsed = parseInt(countryMatch[1]);
          if (Number.isFinite(parsed)) country = parsed;
        } else {
          if (product.title.includes("Индонез")) country = 6;
          else if (product.title.includes("Канад")) country = 34;
          else if (product.title.includes("США") || product.title.includes("USA")) country = 115;
          else if (product.title.includes("Великобритан") || product.title.includes("UK")) country = 16;
          else if (product.title.includes("Португал")) country = 93;
          //RU/UA не поддерживаются smsfast.vip для Telegram — fallback на США(115)
        }
        
        try {
          const result = await smsOrderNumber("tg", country);
          
          pendingSMSOrders.set(order.id, {
            activationId: result.id,
            phone: result.phone,
            attempts: 0,
            chatId: ctx.chat.id,
            tgId: tgId,
            country: country,
          });
          
          await db.orderItem.updateMany({
            where: { orderId: order.id },
            data: { delivered: `phone: ${result.phone}\nID: ${result.id}\n⏳ Ожидание SMS-кода...` },
          });
          
          await db.order.update({ where: { id: order.id }, data: { status: "completed" } });
          
          const kb = new InlineKeyboard()
            .text("🔄 Сменить номер", `chgnum:${order.id}`)
            .row()
            .text("❌ Отменить", `cancelnum:${order.id}`);
          
          await ctx.reply(
            `📱 *Виртуальный номер заказан!*\n\n` +
            `📞 Номер: *${result.phone}*\n` +
            `🔧 ID: ${result.id}\n\n` +
            `1. Введите этот номер в Telegram\n` +
            `2. Дождитесь SMS с кодом\n` +
            `3. Бот автоматически пришлёт код\n\n` +
            `_Если код не придёт — нажмите «🔄 Сменить номер»_`,
            { parse_mode: "Markdown", reply_markup: kb }
          );
          
          pollSMS(order.id, ctx);
        } catch (e: any) {
          console.error("[tg-bot] SMS order error:", e);
          await ctx.reply(
            `⚠️ Не удалось заказать номер: ${e.message}\n\nОбратитесь в поддержку.`,
            { parse_mode: "Markdown", reply_markup: mainMenuInline() }
          );
        }
        return;
      }

      if (isBoost) {
        // === НАКРУТКА ===
        let smmServiceKey = "";
        let quantity = 0;
        if (product.title.includes("10000") && product.title.includes("просмотр")) { smmServiceKey = "tg-views-10000"; quantity = 10000; }
        else if (product.title.includes("50000") && product.title.includes("просмотр")) { smmServiceKey = "tg-views-50000"; quantity = 50000; }
        else if (product.title.includes("1000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-1000"; quantity = 1000; }
        else if (product.title.includes("5000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-5000"; quantity = 5000; }
        else if (product.title.includes("10000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-10000"; quantity = 10000; }
        else if (product.title.includes("1000") && product.title.includes("реакц")) { smmServiceKey = "tg-react-1000"; quantity = 1000; }
        
        if (smmServiceKey && SMM_SERVICES[smmServiceKey]) {
          pendingLinkRequests.set(tgId, {
            orderId: order.id,
            productTitle: product.title,
            smmServiceKey,
            smmServiceId: SMM_SERVICES[smmServiceKey].serviceId,
            quantity,
          });
          
          await db.orderItem.updateMany({
            where: { orderId: order.id },
            data: { delivered: "⏳ Ожидает ссылку для накрутки..." },
          });
          
          // Order is paid but NOT yet completed — completion happens only after
          // the buyer sends a link AND smmCreateOrder succeeds (see link-handler above).
          await db.order.update({ where: { id: order.id }, data: { status: "paid" } });
          
          await ctx.reply(
            `🚀 *Заказ на накрутку оплачен!*\n\n` +
            `Услуга: *${product.title}*\n` +
            `Номер: *${order.number}*\n\n` +
            `📌 *Пришлите ссылку на канал или пост:*\n` +
            `• Для подписчиков: @username или https://t.me/канал\n` +
            `• Для просмотров: https://t.me/канал/123\n` +
            `• Для реакций: https://t.me/канал/123\n\n` +
            `_Накрутка начнётся автоматически после получения ссылки._`,
            { parse_mode: "Markdown" }
          );
        } else {
          await ctx.reply(
            `⚠️ Услуга не найдена в SMM системе. Обратитесь в поддержку.\n\nЗаказ: ${order.number}`,
            { parse_mode: "Markdown", reply_markup: mainMenuInline() }
          );
        }
        return;
      }

      // === ОБЫЧНЫЙ ТОВАР ===
      await deliverOrder(order);
      const fresh = await db.order.findUnique({
        where: { id: order.id },
        include: { items: true },
      });
      await sendDeliveryMessage(ctx, fresh!);
    } catch (e: any) {
      console.error("[tg-bot] successful_payment error:", e);
      // Показываем номер заказа и краткую ошибку — так поддержка сможет быстро помочь.
      const orderNum = (() => { try { const p = JSON.parse(ctx.message?.successful_payment?.invoice_payload || "{}"); return p.orderId || ""; } catch { return ""; } })();
      let orderNumber = "неизвестен";
      if (orderNum) {
        try { const o = await db.order.findUnique({ where: { id: orderNum }, select: { number: true } }); if (o) orderNumber = o.number; } catch {}
      }
      await ctx.reply(
        `⚠️ Ошибка при выдаче товара.\n\n` +
        `Заказ: *${orderNumber}*\n` +
        `Причина: ${String(e?.message || e).slice(0, 200)}\n\n` +
        `Напишите в поддержку с этим номером заказа.`,
        { parse_mode: "Markdown" }
      );
    }
  });

  // Автопроверка SMM-заказов каждые 5 минут.
  // Each getOrderStatus call is wrapped in try/catch so one failure doesn't kill the loop.
  setInterval(async () => {
    try {
      if (!bot) return;
      // Ищем заказы со SMM Order в delivered, которые ещё не завершены
      const orders = await db.order.findMany({
        where: {
          status: "completed",
          items: { some: { delivered: { contains: "SMM Order" } } },
        },
        include: { items: true, customer: true },
      });
      for (const o of orders) {
        for (const it of o.items) {
          if (!it.delivered || !it.delivered.includes("SMM Order")) continue;
          if (it.delivered.includes("✅ Накрутка выполнена")) continue; // уже завершён
          if (it.delivered.includes("Накрутка отменена")) continue;
          
          const smmMatch = it.delivered.match(/SMM Order: #(\d+)/);
          if (!smmMatch) continue;
          const smmId = parseInt(smmMatch[1]);
          if (!Number.isFinite(smmId)) continue;
          
          let status;
          try {
            status = await getOrderStatus(smmId);
          } catch (e: any) {
            console.error(`[smm-poll] getOrderStatus error for SMM #${smmId}:`, e.message);
            continue;
          }
          if (!status || "error" in status) continue;
          
          const s = status.status;
          if (s === "Completed" || s === "Partial") {
            const label = s === "Completed"
              ? `✅ Накрутка выполнена (заказ #${smmId})`
              : `⚠️ Накрутка выполнена частично (заказ #${smmId}, остаток: ${status.remains ?? 0})`;
            await db.orderItem.update({
              where: { id: it.id },
              data: { delivered: it.delivered.replace(/Статус: In progress/i, "Статус: " + s) + "\n" + label },
            });
            if (o.customerTg) {
              try {
                await bot!.api.sendMessage(o.customerTg,
                  `✅ *Накрутка выполнена!*\n\nЗаказ ${o.number}\nSMM #${smmId}\nСтатус: ${s}\n\nСпасибо за покупку! 🙏\nОставьте отзыв: /reviews`,
                  { parse_mode: "Markdown" }
                );
              } catch (e) { console.error("[smm-poll] Notify customer error:", e); }
            }
          } else if (s === "Canceled" || s === "Cancelled") {
            await db.orderItem.update({
              where: { id: it.id },
              data: { delivered: it.delivered.replace(/Статус: In progress/i, "Статус: Canceled") + "\n❌ Накрутка отменена (заказ #" + smmId + ")" },
            });
            if (o.customerTg) {
              try {
                await bot!.api.sendMessage(o.customerTg,
                  `❌ *Накрутка отменена*\n\nЗаказ ${o.number}\nSMM #${smmId}\n\nОбратитесь в поддержку для возврата.`,
                  { parse_mode: "Markdown" }
                );
              } catch (e) { console.error("[smm-poll] Notify customer error:", e); }
            }
          }
        }
      }
    } catch (e) {
      console.error("[smm-poll] error:", e);
    }
  }, 5 * 60 * 1000); // каждые 5 минут

  botRunning = true;

  try {
    console.log("[tg-bot] Starting long-polling...");
    await bot.start({
      onStart: (botInfo) => {
        console.log(`[tg-bot] Bot @${botInfo.username} is up and polling.`);
      },
    });
  } catch (e) {
    botRunning = false;
    console.error("[tg-bot] bot.start() failed:", e);
  }
}

// ---------- SMS Polling ----------
async function pollSMS(orderId: string, ctx: any) {
  const smsOrder = pendingSMSOrders.get(orderId);
  if (!smsOrder) return;
  
  const maxAttempts = 60; // 60 попыток × 10 сек = 10 минут
  
  for (let i = 0; i < maxAttempts; i++) {
    const current = pendingSMSOrders.get(orderId);
    if (!current) return; // заказ отменён или сменён
    
    try {
      const status = await smsGetStatus(current.activationId);
      
      if (status.status === "ok" && status.code) {
        // Код получен!
        const phone = current.phone;
        const activationId = current.activationId;
        pendingSMSOrders.delete(orderId);
        
        // Завершаем активацию на сервисе
        await smsSetStatus(activationId, 6); // 6 = завершить
        
        // Обновляем заказ
        await db.orderItem.updateMany({
          where: { orderId },
          data: { delivered: `📱 Номер: ${phone}\n🔑 Код: ${status.code}` },
        });
        
        // Отправляем код покупателю
        const kb = new InlineKeyboard()
          .text("💬 Поддержка", "support")
          .row()
          .text("⭐ Оставить отзыв", "reviews");
        
        await ctx.api.sendMessage(current.chatId,
          `✅ *SMS-код получен!*\n\n` +
          `📱 Номер: ${phone}\n` +
          `🔑 *Код: ${status.code}*\n\n` +
          `Введите этот код в Telegram для входа.\n\n` +
          `_Код действителен ограниченное время._`,
          { parse_mode: "Markdown", reply_markup: kb }
        );
        return;
      }
      
      if (status.status === "cancel") {
        pendingSMSOrders.delete(orderId);
        await ctx.api.sendMessage(current.chatId,
          "❌ Номер был отменён. Используйте «🔄 Сменить номер» для заказа нового.",
          { reply_markup: new InlineKeyboard().text("🔄 Сменить номер", `chgnum:${orderId}`) }
        );
        return;
      }
    } catch (e: any) {
      console.error("[tg-bot] SMS poll error:", e);
    }
    
    // Ждём 10 секунд
    await new Promise(r => setTimeout(r, 10000));
  }
  
  // Таймаут — код не пришёл за 10 минут
  const current = pendingSMSOrders.get(orderId);
  if (current) {
    pendingSMSOrders.delete(orderId);
    // Отменяем номер на сервисе
    try { await smsSetStatus(current.activationId, 8); } catch {}
    
    await ctx.api.sendMessage(current.chatId,
      "⏰ *Время ожидания истекло*\n\n" +
      "SMS-код не был получен за 10 минут.\n" +
      "Нажмите «🔄 Сменить номер» для заказа нового номера.",
      { parse_mode: "Markdown", reply_markup: new InlineKeyboard().text("🔄 Сменить номер", `chgnum:${orderId}`) }
    );
  }
}

// ---------- Admin menu ----------
async function showAdminMenu(ctx: any) {
  const products = await db.product.count({ where: { active: true } });
  const stock = await db.stockItem.count({ where: { status: "available" } });
  const orders = await db.order.count();
  const pendingOrders = await db.order.count({ where: { status: "pending" } });
  
  const text =
    `🔧 *Админ-панель*\n\n` +
    `📊 *Статистика:*\n` +
    `  Товаров: ${products}\n` +
    `  Аккаунтов на складе: ${stock}\n` +
    `  Заказов: ${orders} (ожидают: ${pendingOrders})\n\n` +
    `*Команды:*\n` +
    `/products — список товаров с ID\n` +
    `/addstock ID — загрузить аккаунты (текстом)\n` +
    `/uploadsession ID PHONE [PASS] [2FA] — загрузить аккаунт с сессией\n` +
    `/stock — остатки на складе\n` +
    `/cancel — отменить загрузку\n\n` +
    `*Для аккаунтов с автокодом:*\n` +
    `1. /uploadsession + .session файл\n` +
    `2. Покупатель получит данные + кнопку «📱 Получить код»\n` +
    `3. Код придёт автоматически из аккаунта`;
  
  await ctx.reply(text, { parse_mode: "Markdown" });
}

// ---------- Catalog flow ----------
async function showCategories(ctx: any) {
  const categories = await db.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: { products: { where: { active: true }, select: { id: true } } },
  });

  if (categories.length === 0) {
    await ctx.reply(
      "Категории пока не добавлены. Загляните позже 🌱",
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const c of categories) {
    kb.text(`${c.icon || "📁"} ${c.name} (${c.products.length})`, `cat:${c.id}`).row();
  }

  await ctx.reply(
    "🛍 *Каталог*\nВыберите категорию:",
    { parse_mode: "Markdown", reply_markup: kb }
  );
}

async function showProductsInCategory(ctx: any, categoryId: string) {
  const products = await db.product.findMany({
    where: { categoryId, active: true },
    orderBy: { salesCount: "desc" },
  });

  if (products.length === 0) {
    const kb = new InlineKeyboard().text("⬅️ Назад", "back_to_cats");
    await ctx.reply("В этой категории пока нет товаров.", { reply_markup: kb });
    return;
  }

  for (const p of products.slice(0, 10)) {
    const stock = await db.stockItem.count({
      where: { productId: p.id, status: "available" },
    });
    const stockLabel = stock > 0 ? `В наличии: ${stock}` : "Нет в наличии";
    const ratingLine = p.rating > 0 ? `${stars(p.rating)} ${p.rating.toFixed(1)}` : "Без оценки";
    const priceLine = formatPrice(p.price, p.currency);
    const oldPriceLine = p.oldPrice
      ? ` ~${formatPrice(p.oldPrice, p.currency)}~`
      : "";

    const text =
      `*${p.title}*\n` +
      `${p.description}\n\n` +
      `💰 ${priceLine}${oldPriceLine}\n` +
      `${ratingLine} · 🛒 ${p.salesCount} продаж\n` +
      `📦 ${stockLabel}`;

    const kb = new InlineKeyboard();
    if (stock > 0) {
      kb.text("🛒 Купить", `buy:${p.id}`);
    } else {
      kb.text("🚫 Нет в наличии", "noop");
    }
    kb.row().text("⬅️ К категориям", "back_to_cats");
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

// ---------- Stars flow ----------
async function showStars(ctx: any) {
  const products = await db.product.findMany({
    where: { type: "stars", active: true },
    orderBy: { price: "asc" },
  });

  if (products.length === 0) {
    await ctx.reply(
      "⭐ Звёзды пока не добавлены в каталог. Загляните позже!",
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  await ctx.reply("⭐ *Покупка Telegram Звёзд*\nВыберите пакет:", {
    parse_mode: "Markdown",
  });

  for (const p of products) {
    const stock = await db.stockItem.count({
      where: { productId: p.id, status: "available" },
    });
    if (stock <= 0) continue;
    const ratingLine = p.rating > 0 ? `${stars(p.rating)} ${p.rating.toFixed(1)}` : "";
    const text =
      `*${p.title}*\n` +
      `${p.description}\n` +
      `💰 ${formatPrice(p.price, p.currency)}` +
      (ratingLine ? `\n${ratingLine}` : "") +
      `\n📦 В наличии: ${stock}`;
    const kb = new InlineKeyboard().text("🛒 Купить", `buy:${p.id}`);
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

// ---------- Orders flow ----------
async function showOrders(ctx: any) {
  const tgId = String(ctx.from?.id ?? "");
  if (!tgId) {
    await ctx.reply("Не удалось определить ваш Telegram ID.", {
      reply_markup: mainMenuKeyboard(),
    });
    return;
  }

  const orders = await db.order.findMany({
    where: { customerTg: tgId },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { items: true },
  });

  if (orders.length === 0) {
    await ctx.reply(
      "📦 У вас пока нет заказов.\nОткройте каталог, чтобы сделать первый заказ 🛍",
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  await ctx.reply("📦 *Ваши последние заказы:*", {
    parse_mode: "Markdown",
  });

  for (const o of orders) {
    const itemsLine = o.items
      .map((i) => `• ${i.title} ×${i.qty} — ${formatPrice(i.price * i.qty, o.currency)}`)
      .join("\n");
    const text =
      `*${o.number}*\n` +
      `${orderStatusLabel(o.status)}\n` +
      `💳 Сумма: ${formatPrice(o.total, o.currency)}\n` +
      `📅 ${formatDate(o.createdAt)}\n` +
      (itemsLine ? `\n${itemsLine}` : "");

    const kb = new InlineKeyboard();
    if (o.status === "pending") {
      // NOTE: the "✅ Оплатил" button was removed — it bypassed payment and delivered for free.
      // Users pay via the Stars invoice sent at order creation. If they lost it, they cancel and re-order.
      kb.text("❌ Отменить", `cancel_order:${o.id}`);
    }
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  }
}

// ---------- Support ----------
async function showSupport(ctx: any) {
  const s = await getSettings();
  const contact = s.supportContact || "@support";
  const text =
    `💬 *Поддержка*\n\n` +
    `Если у вас возникли вопросы по заказу, оплате или доставке — пишите:\n` +
    `${contact}\n\n` +
    `Мы отвечаем с 9:00 до 23:00 (МСК).`;
  await ctx.reply(text, {
    parse_mode: "Markdown",
    reply_markup: mainMenuInline(),
  });
}

// ---------- Reviews ----------
async function showReviews(ctx: any) {
  const WEBAPP = process.env.WEBAPP_URL?.trim() || "";
  // Берём только домен из WEBAPP_URL (убираем /)
  const domain = WEBAPP.split("?")[0].replace(/#.*$/, "");
  const reviewsUrl = domain + "/reviews";
  
  try {
    // Получаем последние отзывы из БД
    const reviews = await db.review.findMany({
      where: { published: true },
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { product: { select: { title: true } } },
    });
    const agg = await db.review.aggregate({
      where: { published: true },
      _avg: { rating: true },
      _count: true,
    });
    const avg = agg._avg.rating ?? 0;
    const total = agg._count;

    let text = `⭐ *Отзывы покупателей*\n\n`;
    text += `Средний рейтинг: *${avg.toFixed(1)}/5* ⭐\n`;
    text += `Всего отзывов: *${total}*\n\n`;
    
    if (reviews.length > 0) {
      text += `*Последние отзывы:*\n\n`;
      for (const r of reviews) {
        const stars = "⭐".repeat(r.rating);
        text += `${stars} *${r.author}*\n`;
        text += `${r.text.slice(0, 100)}${r.text.length > 100 ? "..." : ""}\n`;
        if (r.product) text += `📦 _${r.product.title}_\n`;
        text += `\n`;
      }
    } else {
      text += `Пока нет отзывов. Будьте первым!\n\n`;
    }
    
    text += `📝 *Читать все отзывы и оставить свой:*\n${reviewsUrl}`;

    const kb = new InlineKeyboard()
      .url("🌐 Открыть все отзывы", reviewsUrl)
      .row()
      .text("⬅️ В меню", "noop");
    
    await ctx.reply(text, { parse_mode: "Markdown", reply_markup: kb });
  } catch (e: any) {
    console.error("[tg-bot] showReviews error:", e);
    await ctx.reply("⚠️ Не удалось загрузить отзывы. Попробуйте позже.");
  }
}

// ---------- Open store ----------
async function openStore(ctx: any) {
  const s = await getSettings();
  const url = WEBAPP_URL || s.miniAppUrl || "";
  if (!url) {
    await ctx.reply(
      "🌐 Веб-приложение магазина пока не настроено.",
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }
  const kb = new InlineKeyboard().webApp("🛒 Открыть магазин", url);
  await ctx.reply("🌐 Нажмите кнопку ниже, чтобы открыть магазин:", {
    reply_markup: kb,
  });
}

// ---------- Order creation ----------
// Conversion: 1 Telegram Star = 2 RUB
const STARS_PER_RUB = 1 / 1.4;
function rubToStars(rub: number): number {
  return Math.max(1, Math.round(rub * STARS_PER_RUB));
}

async function createOrderFromProduct(ctx: any, productId: string) {
  const tgId = String(ctx.from?.id ?? "");
  const username = ctx.from?.username;
  const firstName = ctx.from?.first_name;
  const lastName = ctx.from?.last_name;
  const customerName =
    [firstName, lastName].filter(Boolean).join(" ") || username || "Покупатель";

  const product = await db.product.findUnique({ where: { id: productId } });
  if (!product || !product.active) {
    await ctx.reply("Товар не найден или недоступен.");
    return;
  }

  // Check stock (skip services)
  if (product.type !== "service" && !product.slug.includes("nomer") && !product.slug.includes("number") && !product.slug.includes("virtual")) {
    const available = await db.stockItem.count({
      where: { productId, status: "available" },
    });
    if (available < 1) {
      await ctx.reply("К сожалению, товар закончился 🙏", {
        reply_markup: mainMenuInline(),
      });
      return;
    }
  }

  // Resolve / create customer
  const customer = await db.customer.upsert({
    where: { tgId },
    update: { username, firstName, lastName },
    create: { tgId, username, firstName, lastName },
  });

  const order = await db.order.create({
    data: {
      number: genOrderNumber(),
      customerId: customer.id,
      customerTg: tgId,
      customerName,
      status: "pending",
      total: product.price,
      payMethod: "stars",
      items: {
        create: {
          productId: product.id,
          title: product.title,
          price: product.price,
          qty: 1,
        },
      },
    },
    include: { items: true },
  });

  // Reserve stock / mark services
  for (const it of order.items) {
    if (product.type === "service") {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой — старт в течение 1 часа." },
      });
      continue;
    }
    // Atomic stock reservation. Pre-fetch available IDs, then run an updateMany that
    // asserts status="available" so two concurrent buyers can't both grab the same row.
    // If fewer than it.qty rows were updated (race), rollback and cancel the order.
    try {
      const available = await db.stockItem.findMany({
        where: { productId, status: "available" },
        take: it.qty,
        select: { id: true },
      });
      const [updated] = await db.$transaction([
        db.stockItem.updateMany({
          where: { id: { in: available.map((r) => r.id) }, status: "available" },
          data: { status: "reserved", reservedOrderId: order.id },
        }),
      ]);
      if (updated.count < it.qty) {
        // Race: another buyer grabbed some of these rows in the meantime.
        // Release anything we did manage to reserve for this order, then bail.
        await db.stockItem.updateMany({
          where: { reservedOrderId: order.id },
          data: { status: "available", reservedOrderId: null },
        });
        throw new Error("Недостаточно товара на складе");
      }
    } catch (e: any) {
      // Reservation failed — cancel the freshly-created order so it doesn't dangle.
      await db.order.update({ where: { id: order.id }, data: { status: "cancelled" } });
      await db.stockItem.updateMany({
        where: { reservedOrderId: order.id },
        data: { status: "available", reservedOrderId: null },
      });
      await ctx.reply(`⚠️ ${e.message}\n\nЗаказ ${order.number} отменён.`, { reply_markup: mainMenuInline() });
      return;
    }
  }

  // Проверяем это виртуальный номер (slug содержит "nomer" или "number")
  // ВСЕ товары — сначала создаём инвойс для оплаты звёздами
  // После оплаты (successful_payment) — определяем тип и выполняем действие:
  // - Виртуальные номера → заказ через smsfast.vip
  // - Накрутка → запрос ссылки → заказ через SMM API
  // - Обычные товары → выдача со склада
  
  const starsAmount = rubToStars(order.total);
  const label = product.title.slice(0, 32);

    // Send Stars invoice via direct Telegram Bot API fetch (самый надёжный способ)
  try {
    const invoicePayload = JSON.stringify({ orderId: order.id, number: order.number });
    const invoiceDesc = `Оплата заказа ${order.number} = ${starsAmount} stars`;
    const botToken = process.env.BOT_TOKEN!;
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: ctx.chat.id,
        title: label,
        description: invoiceDesc,
        payload: invoicePayload,
        currency: "XTR",
        prices: [{ label, amount: starsAmount }],
      }),
    });
    const tgData = await tgRes.json();
    if (!tgData.ok) {
      throw new Error(`Telegram API: ${tgData.description || tgData.error_code}`);
    }
    await ctx.reply(
      `🧾 Заказ *${order.number}* создан.\n` +
      `Сумма: ${formatPrice(order.total, order.currency)} = *${starsAmount} ⭐*\n\n` +
      `Оплатите инвойс выше ⭐ — товар придёт автоматически.`,
      { parse_mode: "Markdown", reply_markup: mainMenuInline() }
    );
  } catch (e: any) {
    console.error("[tg-bot] sendInvoice error:", e);
    await ctx.reply(
      `⚠️ Не удалось создать счёт для оплаты. Попробуйте позже или напишите в поддержку.\n\nЗаказ: ${order.number}`,
      { reply_markup: mainMenuInline() }
    );
  }
}

// ---------- Delivery core (used by successful_payment) ----------
async function deliverOrder(order: any) {
  const deliveredLines: string[] = [];
  for (const it of order.items) {
    const product = await db.product.findUnique({ where: { id: it.productId } });
    // Service: already "в работе"
    if (product?.type === "service") {
      if (!it.delivered) {
        await db.orderItem.update({
          where: { id: it.id },
          data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой — старт в течение 1 часа." },
        });
      }
      deliveredLines.push(`*${escapeMd(it.title)}*:\n🚀 Заказ принят в работу. Старт в течение 1 часа.`);
      await db.product.update({
        where: { id: it.productId },
        data: { salesCount: { increment: it.qty } },
      });
      continue;
    }
    // Fetch reserved stock SCOPED to THIS order via reservedOrderId (not by productId/status,
    // which could grab another order's reserved items).
    let stock = await db.stockItem.findMany({
      where: { reservedOrderId: order.id, status: "reserved" },
      take: it.qty,
    });
    if (stock.length < it.qty) {
      // Under-delivery: less stock reserved than ordered. Don't silently deliver empty.
      // Log a warning and set a marker; the order will stay "paid" for admin follow-up below.
      console.warn(`[deliverOrder] under-delivery for order ${order.id}, item ${it.id}: needed ${it.qty}, got ${stock.length}`);
    }
    if (stock.length > 0) {
      await db.stockItem.updateMany({
        where: { id: { in: stock.map((s) => s.id) } },
        data: { status: "sold", soldAt: new Date(), reservedOrderId: null },
      });
      const content = stock.map((s) => s.content).join("\n");
      const tail = stock.length < it.qty
        ? `\n\n⚠️ Недостаточно товара: доставлено ${stock.length} из ${it.qty}. Свяжитесь с поддержкой.`
        : "";
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: content + tail },
      });
      deliveredLines.push(`*${escapeMd(it.title)}*:\n\`\`\`\n${content}\n\`\`\``);
      // salesCount increments ONLY when stock was actually delivered (fixes double-count on empty delivery).
      await db.product.update({
        where: { id: it.productId },
        data: { salesCount: { increment: stock.length } },
      });
    } else {
      // Nothing to deliver at all — leave a marker so the customer knows to contact support.
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "⚠️ Недостаточно товара на складе. Свяжитесь с поддержкой." },
      });
      deliveredLines.push(`*${escapeMd(it.title)}*:\n⚠️ Недостаточно товара на складе. Свяжитесь с поддержкой.`);
    }
  }

  // Only mark the order "completed" if EVERY item was fully delivered.
  // If any item under-delivered, leave it "paid" so an admin can follow up.
  const freshOrder = await db.order.findUnique({ where: { id: order.id }, include: { items: true } });
  const allDelivered = (freshOrder?.items ?? []).every((it) => {
    if (!it.delivered) return false;
    // Items with the under-delivery marker are not "fully delivered".
    return !it.delivered.includes("⚠️ Недостаточно товара");
  });
  await db.order.update({
    where: { id: order.id },
    data: { status: allDelivered ? "completed" : "paid" },
  });

  if (order.customer) {
    await db.customer.update({
      where: { id: order.customer.id },
      data: {
        totalSpent: { increment: order.total },
        ordersCount: { increment: 1 },
      },
    });
  }
  return deliveredLines;
}

async function sendDeliveryMessage(ctx: any, order: any) {
  const lines: string[] = [];
  const codeButtons: string[] = [];
  
  for (const it of order.items) {
    if (!it.delivered) continue;
    
    // Проверяем это аккаунт с session или обычный товар
    const isAccountWithSession = it.delivered.includes("session: stored-in-db") || it.delivered.includes("phone:");
    
    if (isAccountWithSession) {
      // Аккаунт — формируем красивую выдачу + кнопку
      const phoneMatch = it.delivered.match(/phone: (.+)/);
      const passMatch = it.delivered.match(/password: (.+)/);
      const twoFAMatch = it.delivered.match(/2FA: (.+)/);
      
      const phone = phoneMatch ? phoneMatch[1] : "не указан";
      const password = passMatch ? passMatch[1] : "нет";
      const twoFA = twoFAMatch ? twoFAMatch[1] : "нет";
      
      codeButtons.push(it.id);
      
      lines.push(
        `*${escapeMd(it.title)}*\n\n` +
        `📱 Телефон: ${phone}\n` +
        `🔐 Пароль: ${password}\n` +
        `🔒 2FA: ${twoFA}\n\n` +
        `⚠️ Для входа:\n` +
        `1. Введите номер ${phone} в Telegram\n` +
        `2. Telegram пришлёт код подтверждения\n` +
        `3. Нажмите кнопку "📱 Получить код" ниже\n` +
        `4. Бот автоматически пришлёт код из аккаунта`
      );
    } else {
      // Обычный товар
      lines.push(`*${escapeMd(it.title)}*:\n${it.delivered.startsWith("🚀") || it.delivered.startsWith("⚠️") ? it.delivered : "```\n" + it.delivered + "\n```"}`);
    }
  }
  
  const summary =
    `🎉 Заказ *${order.number}* оплачен!\n\n` +
    `Спасибо за покупку 🙏\n` +
    `Вот ваш товар:\n\n` +
    lines.join("\n\n");
  
  if (codeButtons.length > 0) {
    const kb = new InlineKeyboard();
    for (const itemId of codeButtons) {
      kb.text("📱 Получить код входа", `getcode:${itemId}`).row();
    }
    kb.text("💬 Поддержка", "support");
    await ctx.reply(summary, { parse_mode: "Markdown", reply_markup: kb });
  } else {
    await ctx.reply(summary, { parse_mode: "Markdown" });
    await ctx.reply("Если есть вопросы — нажмите 💬 Поддержка.", {
      reply_markup: mainMenuInline(),
    });
  }
}

// ---------- Cancel order ----------
async function cancelOrder(ctx: any, orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) {
    await ctx.reply("Заказ не найден.");
    return;
  }
  if (order.status === "completed") {
    await ctx.reply("Нельзя отменить уже выполненный заказ.");
    return;
  }

  // Release reserved stock — SCOPED to this order via reservedOrderId so we never
  // release another order's reserved items.
  await db.stockItem.updateMany({
    where: { reservedOrderId: order.id },
    data: { status: "available", reservedOrderId: null },
  });

  await db.order.update({
    where: { id: orderId },
    data: { status: "cancelled" },
  });

  await ctx.reply(`Заказ ${order.number} отменён. Запас возвращён на склад.`, {
    reply_markup: mainMenuInline(),
  });
}

// ---------- Graceful shutdown ----------
async function shutdown(signal: string) {
  console.log(`[tg-bot] Received ${signal}, shutting down...`);
  if (bot) await bot.stop();
  await db.$disconnect();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// ---------- Boot ----------
(async () => {
  console.log("[tg-bot] Booting mini-service...");
  console.log(`[tg-bot] PORT=${PORT}`);
  console.log(`[tg-bot] BOT_TOKEN=${BOT_TOKEN ? "set" : "(empty)"}`);
  console.log(`[tg-bot] WEBAPP_URL=${WEBAPP_URL || "(empty)"}`);
  console.log("[tg-bot] About to call setupBot...");
  await setupBot();
  console.log("[tg-bot] setupBot completed, botRunning:", botRunning);
})();
// trigger: rebuild with sms-numbers import fix
// trigger: Dockerfile build
