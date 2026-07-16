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
  // FIX 4: 15s timeout — if smsfast hangs, don't hang the bot.
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    console.log("[SMS] response:", text);
    if (text.startsWith("ACCESS_NUMBER:")) {
      const parts = text.split(":");
      const id = parseInt(parts[1], 10);
      if (!Number.isFinite(id) || !parts[2]) {
        throw new Error("Некорректный ответ сервиса номеров: " + text);
      }
      return { id, phone: "+" + parts[2] };
    }
    if (text === "NO_NUMBERS") throw new Error("Нет доступных номеров для этой страны. Попробуйте другую.");
    if (text === "NO_BALANCE") throw new Error("Недостаточно средств на сервисе номеров.");
    throw new Error("Ошибка: " + text);
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("Таймаут — сервис номеров не ответил за 15 сек");
    }
    throw e;
  }
}

async function smsGetStatus(id: number): Promise<{ status: string; code?: string }> {
  // FIX 4: 15s timeout — if smsfast hangs, don't hang the poll loop.
  try {
    const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=getStatus&id=${id}`, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (text.startsWith("STATUS_OK:")) return { status: "ok", code: text.split(":")[1]?.trim() };
    if (text === "STATUS_WAIT_CODE") return { status: "wait" };
    if (text === "STATUS_CANCEL") return { status: "cancel" };
    return { status: text };
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("Таймаут — сервис номеров не ответил за 15 сек");
    }
    throw e;
  }
}

async function smsSetStatus(id: number, status: number): Promise<string> {
  // FIX 4: 15s timeout — if smsfast hangs, don't hang the caller.
  try {
    const res = await fetch(`${SMS_API}?api_key=${SMS_KEY}&action=setStatus&id=${id}&status=${status}`, { signal: AbortSignal.timeout(15000) });
    return await res.text();
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("Таймаут — сервис номеров не ответил за 15 сек");
    }
    throw e;
  }
}
// === END SMS NUMBERS ===

const PORT = Number(process.env.PORT) || 3004;
const BOT_TOKEN = process.env.BOT_TOKEN?.trim() || "";
const WEBAPP_URL = process.env.WEBAPP_URL?.trim() || "";

let botRunning = false;
let bot: Bot | null = null;

// Pending uploads for admin mode: userId → { productId, productTitle }
const pendingUploads = new Map<string, { productId: string; productTitle: string }>();

// Pending SMS orders: orderId → { activationId, phone, attempts, chatId, gen }
// H1: `gen` is a generation counter — incremented on chgnum so an in-flight pollSMS
// from the previous number can detect it's stale and abort (prevents duplicate SMS delivery).
const pendingSMSOrders = new Map<string, { activationId: number; phone: string; attempts: number; chatId: number; tgId: string; country: number; gen: number }>();

// Pending link requests for SMM orders: orderId → { ..., tgId }
// C1: keyed by orderId (not tgId) so a user's second boost order doesn't overwrite
// the first one and leave it stuck forever. tgId is stored in the value for lookup.
const pendingLinkRequests = new Map<string, { orderId: string; productTitle: string; smmServiceKey: string; smmServiceId: string; quantity: number; tgId: string }>();

// Pending session uploads: userId → { productId, phone, password, twoFA }
const pendingSessionUploads = new Map<string, { productId: string; phone: string; password: string; twoFA: string }>();

// ---------- HTTP health server (Node.js http — работает везде) ----------
const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "", `http://localhost:${PORT}`);

  // Health check
  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      bot: botRunning ? "running" : "idle",
    }));
    return;
  }

  // POST /deliver-card-order — вызывается Next.js webhook Platega сразу
  // после подтверждения оплаты. Body: { orderId: string }
  // Бот мгновенно заказывает виртуальный номер / выдаёт товар, без ожидания
  // 5-минутного poller'а.
  if (req.method === "POST" && url.pathname === "/deliver-card-order") {
    try {
      // Простой shared-secret для авторизации (чтобы никто посторонний не вызывал)
      const authHeader = req.headers["x-deliver-key"] || "";
      const expectedKey = process.env.DELIVER_KEY || "";
      if (expectedKey && authHeader !== expectedKey) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const { orderId } = body as { orderId?: string };

      if (!orderId) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "orderId required" }));
        return;
      }

      console.log(`[deliver-card-order] received for order ${orderId}`);
      // Асинхронно запускаем обработку — не блокируем ответ
      deliverCardOrder(orderId).catch((e) => {
        console.error(`[deliver-card-order] failed for ${orderId}:`, e?.message || e);
      });

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message: "processing started" }));
    } catch (e: any) {
      console.error("[deliver-card-order] error:", e?.message || e);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "internal error" }));
    }
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});
httpServer.listen(PORT, () => {
  console.log(`[tg-bot] HTTP health server listening on :${PORT}`);
});

// deliverCardOrder — вызывается из HTTP endpoint при получении card-платежа.
// Определяет тип товара и либо заказывает виртуальный номер, либо ничего
// (для обычных товаров Next.js webhook уже выдал сток сам).
async function deliverCardOrder(orderId: string) {
  console.log(`[deliver-card-order] processing order ${orderId}`);
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) {
    console.log(`[deliver-card-order] order ${orderId} not found`);
    return;
  }
  if (order.status !== "paid" && order.status !== "completed") {
    console.log(`[deliver-card-order] order ${order.number} status=${order.status}, skip`);
    return;
  }

  const firstItem = order.items[0];
  if (!firstItem) return;
  const product = await db.product.findUnique({
    where: { id: firstItem.productId },
    include: { category: true },
  });
  if (!product) return;

  // Проверить, виртуальный ли это номер
  const catSlug = product.category?.slug ?? "";
  const slugLower = product.slug.toLowerCase();
  const titleLower = product.title.toLowerCase();
  const isVirtual =
    catSlug === "virtual-numbers" ||
    slugLower.includes("nomer") || slugLower.includes("number") ||
    slugLower.includes("virtual") || slugLower.includes("sms") ||
    titleLower.includes("виртуальн") || titleLower.includes("номер");

  if (isVirtual) {
    // Заказываем номер через smsfast.vip
    if (pendingSMSOrders.has(orderId)) {
      console.log(`[deliver-card-order] ${order.number}: already in pendingSMSOrders, skip`);
      return;
    }

    const COUNTRY_FALLBACK_CHAIN = [6, 16, 115, 34, 93];
    let preferredCountry = 115;
    if (product.title.includes("Индонез")) preferredCountry = 6;
    else if (product.title.includes("Канад")) preferredCountry = 34;
    else if (product.title.includes("США") || product.title.includes("USA")) preferredCountry = 115;
    else if (product.title.includes("Великобритан") || product.title.includes("UK")) preferredCountry = 16;
    else if (product.title.includes("Португал")) preferredCountry = 93;
    const tryCountries = [preferredCountry, ...COUNTRY_FALLBACK_CHAIN.filter(c => c !== preferredCountry)];

    let result: { id: number; phone: string } | null = null;
    let usedCountry = preferredCountry;
    let lastError = "";
    for (const c of tryCountries) {
      try {
        console.log(`[deliver-card-order] trying country=${c} for ${order.number}`);
        result = await smsOrderNumber("tg", c);
        usedCountry = c;
        break;
      } catch (e: any) {
        lastError = String(e?.message || e);
        if (lastError.includes("NO_NUMBERS") || lastError.includes("Нет доступных номеров")) continue;
        break;
      }
    }

    if (!result) {
      console.error(`[deliver-card-order] ${order.number}: all countries failed: ${lastError}`);
      const adminId = process.env.ADMIN_TG_ID?.trim();
      if (adminId && bot) {
        try {
          await bot.api.sendMessage(adminId,
            `🚨 Card-paid virtual number failed!\n\nOrder: ${order.number}\nUser: ${order.customerTg}\nError: ${lastError.slice(0, 150)}`,
          );
        } catch {}
      }
      await db.orderItem.updateMany({
        where: { orderId: order.id },
        data: { delivered: `⚠️ Не удалось заказать номер: ${lastError.slice(0, 100)}. Обратитесь в поддержку.` },
      });
      return;
    }

    pendingSMSOrders.set(orderId, {
      activationId: result.id,
      phone: result.phone,
      attempts: 0,
      chatId: 0,
      tgId: order.customerTg || "",
      country: usedCountry,
      gen: 0,
    });

    await db.orderItem.updateMany({
      where: { orderId: order.id },
      data: { delivered: `phone: ${result.phone}\nID: ${result.id}\n⏳ Ожидание SMS-кода...` },
    });
    await db.order.update({ where: { id: order.id }, data: { status: "paid" } });

    // Уведомить покупателя
    if (bot && order.customerTg) {
      try {
        const chatId = Number(order.customerTg);
        if (Number.isFinite(chatId)) {
          const kb = new InlineKeyboard()
            .text("🔄 Сменить номер", `chgnum:${order.id}`)
            .row()
            .text("❌ Отменить", `cancelnum:${order.id}`);
          await safeSendMessage(bot.api, chatId,
            `📱 *Виртуальный номер заказан!*\n\n` +
            `📞 Номер: *${result.phone}*\n` +
            `🔧 ID: ${result.id}\n\n` +
            `1. Введите этот номер в Telegram\n` +
            `2. Дождитесь SMS с кодом\n` +
            `3. Бот автоматически пришлёт код\n\n` +
            `_Если код не придёт за 10 минут — нажмите «🔄 Сменить номер»_`,
            { reply_markup: kb }
          );
        }
      } catch (e: any) {
        console.error(`[deliver-card-order] notify buyer failed:`, e?.message || e);
      }
    }

    const fakeCtx = { api: bot?.api, chat: { id: 0 } };
    pollSMS(orderId, fakeCtx);
    console.log(`[deliver-card-order] ${order.number}: ordered ${result.phone} (country=${usedCountry}), pollSMS started`);
  } else if (product.type === "service") {
    // Для накрутки — определить smmServiceKey, установить pendingLinkRequests,
    // уведомить покупателя что нужно прислать ссылку.
    let smmServiceKey = "";
    let quantity = 0;
    if (product.title.includes("10000") && product.title.includes("просмотр")) { smmServiceKey = "tg-views-10000"; quantity = 10000; }
    else if (product.title.includes("50000") && product.title.includes("просмотр")) { smmServiceKey = "tg-views-50000"; quantity = 50000; }
    else if (product.title.includes("1000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-1000"; quantity = 1000; }
    else if (product.title.includes("5000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-5000"; quantity = 5000; }
    else if (product.title.includes("10000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-10000"; quantity = 10000; }
    else if (product.title.includes("1000") && product.title.includes("реакц")) { smmServiceKey = "tg-react-1000"; quantity = 1000; }
    else if (product.title.includes("150") && product.title.includes("реакц")) { smmServiceKey = "tg-react-150"; quantity = 150; }
    else if (product.title.includes("100") && product.title.includes("реакц")) { smmServiceKey = "tg-react-100"; quantity = 100; }
    else if (product.title.includes("50") && product.title.includes("реакц")) { smmServiceKey = "tg-react-50"; quantity = 50; }

    if (smmServiceKey && SMM_SERVICES[smmServiceKey]) {
      // Установить pendingLinkRequests keyed by order.id (C1 fix)
      pendingLinkRequests.set(order.id, {
        orderId: order.id,
        productTitle: product.title,
        smmServiceKey,
        smmServiceId: SMM_SERVICES[smmServiceKey].serviceId,
        quantity,
        tgId: order.customerTg || "",
      });

      await db.orderItem.updateMany({
        where: { orderId: order.id },
        data: { delivered: "⏳ Ожидает ссылку для накрутки..." },
      });
      // Order stays "paid" — completion happens after smmCreateOrder succeeds
      // (see message:text link-handler)
      await db.order.update({ where: { id: order.id }, data: { status: "paid" } });

      console.log(`[deliver-card-order] ${order.number}: boost order set up, waiting for link (key=${smmServiceKey}, qty=${quantity})`);

      // Уведомить покупателя
      if (bot && order.customerTg) {
        try {
          const chatId = Number(order.customerTg);
          if (Number.isFinite(chatId)) {
            await safeSendMessage(bot.api, chatId,
              `🚀 *Заказ на накрутку оплачен!*\n\n` +
              `Услуга: *${product.title}*\n` +
              `Номер: *${order.number}*\n\n` +
              `📌 *Пришлите ссылку на канал или пост:*\n` +
              `• Для подписчиков: @username или https://t.me/канал\n` +
              `• Для просмотров: https://t.me/канал/123\n` +
              `• Для реакций: https://t.me/канал/123\n\n` +
              `_Накрутка начнётся автоматически после получения ссылки._`
            );
          }
        } catch (e: any) {
          console.error(`[deliver-card-order] notify boost buyer failed:`, e?.message || e);
        }
      }
    } else {
      // SMM service not found — notify admin
      console.error(`[deliver-card-order] ${order.number}: SMM service not found for title "${product.title}"`);
      const adminId = process.env.ADMIN_TG_ID?.trim();
      if (adminId && bot) {
        try {
          await bot.api.sendMessage(adminId,
            `🚨 Накрутка: SMM service не найден!\n\nOrder: ${order.number}\nProduct: ${product.title}\nUser: ${order.customerTg}`
          );
        } catch {}
      }
      await db.orderItem.updateMany({
        where: { orderId: order.id },
        data: { delivered: "⚠️ Услуга не найдена в SMM системе. Обратитесь в поддержку." },
      });
    }
  } else if (product.type === "account") {
    // FIX H-2: card-paid account orders — find reserved StockItem(s), mark sold,
    // send buyer the account data + "📱 Получить код" inline button (so they can fetch
    // the Telegram login code via mtproto). The webhook's local deliverOrder skips
    // account-type orders so we own this path.
    const stock = await db.stockItem.findMany({
      where: { reservedOrderId: order.id, status: "reserved" },
      take: firstItem.qty,
    });
    if (stock.length > 0) {
      await db.stockItem.updateMany({
        where: { id: { in: stock.map(s => s.id) } },
        data: { status: "sold", soldAt: new Date(), reservedOrderId: null },
      });
      const content = stock.map(s => s.content).join("\n");
      await db.orderItem.update({
        where: { id: firstItem.id },
        data: { delivered: content },
      });
      await db.product.update({
        where: { id: product.id },
        data: { salesCount: { increment: stock.length } },
      });

      // Отправить покупателю данные аккаунта + кнопку получения кода
      if (bot && order.customerTg) {
        try {
          const chatId = Number(order.customerTg);
          if (Number.isFinite(chatId)) {
            const itemId = firstItem.id;
            const kb = new InlineKeyboard()
              .text("📱 Получить код входа", `getcode:${itemId}`).row()
              .text("💬 Поддержка", "support");
            await safeSendMessage(bot.api, chatId,
              `🎉 *Заказ оплачен!*\n\n` +
              `Вот ваш товар:\n\n` +
              `*${escapeMd(firstItem.title)}*:\n\`\`\`\n${content}\n\`\`\`\n\n` +
              `⚠️ Для входа:\n` +
              `1. Введите номер в Telegram\n` +
              `2. Telegram пришлёт код\n` +
              `3. Нажмите "📱 Получить код входа"`,
              { reply_markup: kb }
            );
          }
        } catch (e: any) {
          console.error(`[deliver-card-order] notify account buyer failed:`, e?.message || e);
        }
      }

      await db.order.update({ where: { id: order.id }, data: { status: "completed" } });
      if (order.customerId) {
        await db.customer.update({
          where: { id: order.customerId },
          data: { totalSpent: { increment: order.total }, ordersCount: { increment: 1 } },
        });
      }
      console.log(`[deliver-card-order] ${order.number}: account delivered, getcode button sent`);
    } else {
      await db.orderItem.update({
        where: { id: firstItem.id },
        data: { delivered: "⚠️ Недостаточно товара. Свяжитесь с поддержкой." },
      });
    }
  }
  // Для обычных товаров (stars) — Next.js webhook уже выдал сток сам.
}

// ---------- Helpers for keyboards ----------
function mainMenuKeyboard() {
  const kb = new Keyboard()
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

// safeReply: try Markdown first; if Telegram rejects the formatting (e.g. unmatched
// *, _, ` from dynamic content like phone numbers or error messages), retry as plain
// text so the user ALWAYS gets the message instead of a silent failure.
async function safeReply(ctx: any, text: string, extra: any = {}) {
  try {
    return await ctx.reply(text, { parse_mode: "Markdown", ...extra });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("can't parse entities") || msg.includes("Bad Request") || msg.includes("can't parse")) {
      try {
        // Strip Markdown markers for the plain-text fallback so the user doesn't see literal * _ `
        const plain = text.replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
        return await ctx.reply(plain, { ...extra, parse_mode: undefined });
      } catch (e2: any) {
        console.error("[safeReply] plain-text retry also failed:", e2?.message || e2);
        throw e2;
      }
    }
    throw e;
  }
}

// H5: safeSendMessage — same fallback logic as safeReply, but for ctx.api.sendMessage
// (used by the SMM poll loop and admin notifications to push messages to a chatId).
async function safeSendMessage(api: any, chatId: number | string, text: string, extra: any = {}) {
  try {
    return await api.sendMessage(chatId, text, { parse_mode: "Markdown", ...extra });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("can't parse") || msg.includes("Bad Request")) {
      try {
        const plain = text.replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
        return await api.sendMessage(chatId, plain, { ...extra, parse_mode: undefined });
      } catch (e2: any) {
        console.error("[safeSendMessage] retry failed:", e2?.message || e2);
      }
    }
    throw e;
  }
}

// H6: safeReplyLong — Telegram caps messages at 4096 chars. Split a long message
// on double-newline boundaries into chunks <= MAX chars and send them sequentially.
// Only the last chunk carries `extra` (e.g. reply_markup) so the keyboard shows once.
async function safeReplyLong(ctx: any, text: string, extra: any = {}) {
  const MAX = 3800;
  if (text.length <= MAX) return safeReply(ctx, text, extra);
  // Split on double newline boundaries
  const parts: string[] = [];
  let buf = "";
  for (const para of text.split("\n\n")) {
    if ((buf + "\n\n" + para).length > MAX) {
      if (buf) parts.push(buf);
      buf = para;
    } else {
      buf = buf ? buf + "\n\n" + para : para;
    }
  }
  if (buf) parts.push(buf);
  for (let i = 0; i < parts.length; i++) {
    await safeReply(ctx, parts[i], i === parts.length - 1 ? extra : {});
  }
}

// H9: catch stray promise rejections / uncaught exceptions so they at least get logged
// instead of crashing the process silently.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

// ---------- Recovery on bot restart (FIX B-1) ----------
// pendingSMSOrders and pendingLinkRequests are in-memory Maps — a bot restart loses
// them, leaving paid orders stuck forever. recoverPendingOrders() scans the DB for
// orders that need follow-up (status=paid with a phone marker, status=paid with the
// "waiting for link" marker, card-paid virtual-number orders awaiting delivery) and
// re-populates the Maps + restarts the pollers so delivery resumes.
async function recoverPendingOrders() {
  try {
    console.log("[recovery] scanning for stuck paid orders...");

    // 1. Recover virtual number orders (status=paid, delivered starts with "phone:")
    const smsOrders = await db.order.findMany({
      where: { status: "paid", items: { some: { delivered: { startsWith: "phone:" } } } },
      include: { items: true },
      take: 50,
    });
    for (const order of smsOrders) {
      const item = order.items[0];
      if (!item?.delivered) continue;
      // Parse activationId from delivered ("ID: 12345")
      const idMatch = item.delivered.match(/ID: (\d+)/);
      const phoneMatch = item.delivered.match(/phone: ([+\d]+)/);
      if (!idMatch || !phoneMatch) continue;
      const activationId = parseInt(idMatch[1], 10);
      const phone = phoneMatch[1];
      if (!Number.isFinite(activationId)) continue;
      if (pendingSMSOrders.has(order.id)) continue; // already active

      console.log(`[recovery] resuming SMS poll for ${order.number} (activation ${activationId})`);
      pendingSMSOrders.set(order.id, {
        activationId,
        phone,
        attempts: 0,
        chatId: 0,
        tgId: order.customerTg || "",
        country: 115,
        gen: 0,
      });
      const fakeCtx = { api: bot?.api, chat: { id: 0 } };
      pollSMS(order.id, fakeCtx);
    }

    // 2. Recover boost orders (status=paid, delivered = "⏳ Ожидает ссылку для накрутки...")
    const boostOrders = await db.order.findMany({
      where: { status: "paid", items: { some: { delivered: "⏳ Ожидает ссылку для накрутки..." } } },
      include: { items: true },
      take: 50,
    });
    for (const order of boostOrders) {
      if (pendingLinkRequests.has(order.id)) continue;
      const item = order.items[0];
      if (!item) continue;
      const product = await db.product.findUnique({ where: { id: item.productId } });
      if (!product) continue;

      // Determine smmServiceKey (same matching logic)
      let smmServiceKey = "";
      let quantity = 0;
      if (product.title.includes("10000") && product.title.includes("просмотр")) { smmServiceKey = "tg-views-10000"; quantity = 10000; }
      else if (product.title.includes("50000") && product.title.includes("просмотр")) { smmServiceKey = "tg-views-50000"; quantity = 50000; }
      else if (product.title.includes("1000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-1000"; quantity = 1000; }
      else if (product.title.includes("5000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-5000"; quantity = 5000; }
      else if (product.title.includes("10000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-10000"; quantity = 10000; }
      else if (product.title.includes("1000") && product.title.includes("реакц")) { smmServiceKey = "tg-react-1000"; quantity = 1000; }
      else if (product.title.includes("150") && product.title.includes("реакц")) { smmServiceKey = "tg-react-150"; quantity = 150; }
      else if (product.title.includes("100") && product.title.includes("реакц")) { smmServiceKey = "tg-react-100"; quantity = 100; }
      else if (product.title.includes("50") && product.title.includes("реакц")) { smmServiceKey = "tg-react-50"; quantity = 50; }

      if (smmServiceKey && SMM_SERVICES[smmServiceKey]) {
        console.log(`[recovery] resuming boost order ${order.number} (key=${smmServiceKey})`);
        pendingLinkRequests.set(order.id, {
          orderId: order.id,
          productTitle: product.title,
          smmServiceKey,
          smmServiceId: SMM_SERVICES[smmServiceKey].serviceId,
          quantity,
          tgId: order.customerTg || "",
        });
        // Re-notify buyer
        if (bot && order.customerTg) {
          try {
            const chatId = Number(order.customerTg);
            if (Number.isFinite(chatId)) {
              await safeSendMessage(bot.api, chatId,
                `🚀 *Напоминание: ожидаем ссылку для накрутки*\n\n` +
                `Услуга: *${product.title}*\n` +
                `Номер: *${order.number}*\n\n` +
                `📌 *Пришлите ссылку на канал или пост:*\n` +
                `• Для подписчиков: @username или https://t.me/канал\n` +
                `• Для просмотров/реакций: https://t.me/канал/123`
              );
            }
          } catch {}
        }
      }
    }

    // 3. Recover card-paid virtual numbers with "Номер будет заказан ботом" marker
    const cardPending = await db.order.findMany({
      where: { payMethod: "card", status: { in: ["paid", "completed"] }, items: { some: { delivered: { contains: "Номер будет заказан ботом" } } } },
      take: 20,
    });
    if (cardPending.length > 0) {
      console.log(`[recovery] ${cardPending.length} card-paid virtual orders need delivery`);
      // These will be picked up by processPendingCardPaidVirtualNumbers poller
    }

    console.log("[recovery] done");
  } catch (e: any) {
    console.error("[recovery] error:", e?.message || e);
  }
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
      `👋 Добро пожаловать в *${escapeMd(s.storeName)}*!\n\n` +
      `${escapeMd(s.tagline)}\n\n` +
      `Выберите действие из меню ниже 👇`;
    await safeReply(ctx, text, {
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
      `⭐ Купить Звёзды — быстрый список звёзд\n` +
      `📦 Мои заказы — последние заказы\n` +
      `💬 Поддержка — контакт поддержки\n` +
      `🌐 Открыть магазин — открыть веб-приложение`;
    await safeReply(ctx, text, {
      reply_markup: mainMenuKeyboard(),
    });
  });

  // ============ АДМИН-КОМАНДЫ ============
  // Доступ только для ADMIN_TG_ID (ваш Telegram ID)
  
  // /admin — главное меню админа
  bot.command("admin", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id ?? "");
    if (!adminId || userId !== adminId) {
      await safeReply(ctx, "⛔ У вас нет доступа к админ-панели.");
      return;
    }
    await showAdminMenu(ctx);
  });

  // /addstock <productId> — режим добавления аккаунтов
  bot.command("addstock", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id ?? "");
    if (!adminId || userId !== adminId) {
      await safeReply(ctx, "⛔ Доступ запрещён.");
      return;
    }
    const args = ctx.match?.trim().split(/\s+/) || [];
    if (args.length === 0) {
      await safeReply(
        ctx,
        "📝 *Добавление аккаунтов на склад\n\n*" +
        "Использование:\n" +
        "`/addstock PRODUCT_ID`\n\n" +
        "После этого отправьте текст с аккаунтами (по одному на строку).\n\n" +
        "Чтобы узнать PRODUCT_ID — используйте `/products`"
      );
      return;
    }
    const productId = args[0];
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) {
      await safeReply(ctx, "❌ Товар не найден. Используйте `/products` для списка ID.");
      return;
    }
    // Сохраняем режим — ждём следующее сообщение с аккаунтами
    pendingUploads.set(userId, { productId, productTitle: product.title });
    await safeReply(
      ctx,
      `📝 *Режим загрузки аккаунтов*\n\n` +
      `Товар: *${escapeMd(product.title)}*\n` +
      `ID: \`${escapeMd(productId)}\`\n\n` +
      `Отправьте следующее сообщение с аккаунтами.\n` +
      `Формат — по одному на строку:\n\n` +
      `_login:pass\nlogin:pass\nlogin:pass_\n\n` +
      `Или пришлите /cancel для отмены.`
    );
  });

  // /uploadsession <productId> <phone> [password] [2FA] — загрузка сессии аккаунта
  bot.command("uploadsession", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id ?? "");
    if (!adminId || userId !== adminId) {
      await safeReply(ctx, "⛔ Доступ запрещён.");
      return;
    }
    const args = ctx.match?.trim().split(/\s+/) || [];
    if (args.length < 2) {
      await safeReply(
        ctx,
        "📝 *Загрузка аккаунта с сессией*\n\n" +
        "Формат:\n" +
        "`/uploadsession PRODUCT_ID PHONE [PASSWORD] [2FA]`\n\n" +
        "Пример:\n" +
        "`/uploadsession abc123 +79123456789 MyPass123 TwoFA456`\n\n" +
        "После этого пришлите .session файл как документ."
      );
      return;
    }
    const productId = args[0];
    const phone = args[1];
    const password = args[2] || "";
    const twoFA = args[3] || "";
    
    const product = await db.product.findUnique({ where: { id: productId } });
    if (!product) {
      await safeReply(ctx, "❌ Товар не найден. Используйте `/products`.");
      return;
    }
    
    pendingSessionUploads.set(userId, { productId, phone, password, twoFA });
    await safeReply(
      ctx,
      `📱 *Загрузка аккаунта*\n\n` +
      `Товар: *${escapeMd(product.title)}*\n` +
      `Телефон: ${escapeMd(phone)}\n` +
      `Пароль: ${password ? "✓" : "нет"}\n` +
      `2FA: ${twoFA ? "✓" : "нет"}\n\n` +
      `Теперь пришлите .session файл как документ.\n` +
      `Или /cancel для отмены.`
    );
  });

  // Обработка документа (.session файла)
  bot.on("message:document", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id ?? "");
    
    if (!adminId || userId !== adminId || !pendingSessionUploads.has(userId)) {
      return;
    }
    
    const upload = pendingSessionUploads.get(userId)!;
    const doc = ctx.message.document;
    const fileName = doc.file_name || "unknown";
    
    if (!fileName.endsWith(".session") && !fileName.endsWith(".txt")) {
      await safeReply(ctx, "❌ Ожидается .session файл. Попробуйте ещё раз или /cancel");
      return;
    }
    
    try {
      // M6: file-size guard — reject files >1 MB up-front to avoid huge fetches.
      if (doc.file_size && doc.file_size > 1_000_000) {
        await safeReply(ctx, "⚠️ Файл слишком большой (макс 1 МБ).");
        return;
      }
      // Скачиваем файл
      const fileUrl = await ctx.api.getFile(doc.file_id);
      // M4: use the trimmed BOT_TOKEN constant, not the raw env var (which may have whitespace).
      const fileResp = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fileUrl.file_path}`);
      // M5: read as binary buffer, then base64-encode for safe DB storage.
      // mtproto.ts should base64-decode this before using it as a StringSession.
      const buf = Buffer.from(await fileResp.arrayBuffer());
      const sessionContent = buf.toString("base64");
      
      if (sessionContent.length < 50) {
        await safeReply(ctx, "❌ Session файл слишком короткий. Проверьте содержимое.");
        return;
      }
      
      // Создаём StockItem с данными аккаунта (sessionContent — base64-строка — хранится в sessionFile)
      const stockItem = await db.stockItem.create({
        data: {
          productId: upload.productId,
          content: `phone: ${upload.phone}\npassword: ${upload.password || "нет"}\n2FA: ${upload.twoFA || "нет"}\nsession: stored-in-db`,
          status: "available",
          phone: upload.phone,
          password: upload.password || null,
          twoFA: upload.twoFA || null,
          sessionFile: sessionContent, // base64-encoded StringSession хранится прямо в БД
        },
      });
      
      pendingSessionUploads.delete(userId);
      
      const totalStock = await db.stockItem.count({
        where: { productId: upload.productId, status: "available" },
      });
      
      await safeReply(
        ctx,
        `✅ *Аккаунт загружен!*\n\n` +
        `Товар: ${upload.productId}\n` +
        `Телефон: ${upload.phone}\n` +
        `Session: ${fileName}\n` +
        `ID склада: ${stockItem.id}\n\n` +
        `Всего на складе: ${totalStock}\n\n` +
        `Используйте /uploadsession для ещё одного аккаунта.`
      );
    } catch (e: any) {
      console.error("Session upload error:", e);
      await safeReply(ctx, `❌ Ошибка: ${String(e?.message || e).slice(0, 200)}`);
    }
  });

  // /products — список всех товаров с ID
  bot.command("products", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id ?? "");
    if (!adminId || userId !== adminId) {
      await safeReply(ctx, "⛔ Доступ запрещён.");
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
      text += `*${escapeMd(p.title)}*\n`;
      text += `  ID: \`${escapeMd(p.id)}\`\n`;
      text += `  Цена: ${formatPrice(p.price)} | Склад: ${stock}\n\n`;
    }
    text += "\nИспользуйте: `/addstock ID` для загрузки аккаунтов";
    // H6: list may exceed 4096 chars with many products — chunk it.
    await safeReplyLong(ctx, text);
  });

  // /stock — остатки на складе
  bot.command("stock", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id ?? "");
    if (!adminId || userId !== adminId) {
      await safeReply(ctx, "⛔ Доступ запрещён.");
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
      text += `${status} *${escapeMd(p.title)}*\n  В наличии: ${available} | Продано: ${sold}\n`;
    }
    text += `\n*Всего на складе: ${totalAvailable}*`;
    await safeReplyLong(ctx, text);
  });

  // /smmstatus — статус SMM (для админа)
  bot.command("smmstatus", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id ?? "");
    if (!adminId || userId !== adminId) {
      await safeReply(ctx, "⛔ Доступ запрещён.");
      return;
    }
    const balance = await getBalance();
    let text = "📊 *SMM Статус (twiboost)*\n\n";
    if ("error" in balance) {
      text += `❌ Ошибка: ${escapeMd(balance.error)}`;
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
      const smmId = smmMatch ? parseInt(smmMatch[1], 10) : null;
      let status = "?";
      if (smmId) {
        const st = await getOrderStatus(smmId);
        if (!("error" in st)) status = st.status;
      }
      text += `• ${escapeMd(o.number)} → ${escapeMd(status)}\n`;
    }
    await safeReplyLong(ctx, text);
  });

  // /refund <orderId> — manual Stars refund for an order (admin only).
  // FIX 1: needed because cancelOrder's auto-refund only fires for paid/completed orders,
  // and because some edge cases (e.g. customer reports an issue post-completion) need a
  // manual path. Requires starPaymentChargeId to have been persisted at payment time.
  bot.command("refund", async (ctx) => {
    const adminId = process.env.ADMIN_TG_ID?.trim();
    const userId = String(ctx.from?.id ?? "");
    if (!adminId || userId !== adminId) return;
    const orderId = ctx.message?.text?.split(/\s+/)[1]?.trim();
    if (!orderId) { await ctx.reply("Использование: /refund <orderId>"); return; }
    try {
      const order = await db.order.findUnique({
        where: { id: orderId },
        select: { id: true, number: true, status: true, customerTg: true, starPaymentChargeId: true },
      });
      if (!order) { await ctx.reply("Заказ не найден"); return; }
      if (!order.starPaymentChargeId) { await ctx.reply("У заказа нет Star payment charge id — вернуть нельзя."); return; }
      if (!order.customerTg) { await ctx.reply("У заказа нет customerTg — вернуть нельзя."); return; }
      await bot!.api.refundStarPayment(Number(order.customerTg), order.starPaymentChargeId);
      await db.order.update({ where: { id: orderId }, data: { status: "refunded" } });
      await ctx.reply(`✅ Рефанд выполнен.\nЗаказ: ${order.number}\nCharge: ${order.starPaymentChargeId}`);
    } catch (e: any) {
      await ctx.reply(`❌ Ошибка: ${String(e?.message || e).slice(0, 200)}`);
    }
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
    await safeReply(
      ctx,
      "📋 *Юридическая информация*\n\nВыберите документ для просмотра:",
      { reply_markup: kb }
    );
  });

  // /cancel — отмена режима загрузки
  bot.command("cancel", async (ctx) => {
    const userId = String(ctx.from?.id ?? "");
    let cancelled = false;
    if (pendingUploads.has(userId)) {
      pendingUploads.delete(userId);
      cancelled = true;
    }
    if (pendingSessionUploads.has(userId)) {
      pendingSessionUploads.delete(userId);
      cancelled = true;
    }
    // H8: also clear any pending SMS orders for this user — release the SMS-provider
    // number so the customer isn't billed for a leaked reservation.
    for (const [orderId, so] of pendingSMSOrders) {
      if (so.tgId === userId) {
        try { await smsSetStatus(so.activationId, 8); } catch (e: any) {
          console.error("[cancel] release SMS number failed:", e?.message || e);
        }
        pendingSMSOrders.delete(orderId);
        cancelled = true;
      }
    }
    // H8/C1: clear pending link requests (now keyed by orderId) for this user.
    for (const [orderId, req] of pendingLinkRequests) {
      if (req.tgId === userId) {
        pendingLinkRequests.delete(orderId);
        cancelled = true;
      }
    }
    if (cancelled) {
      await safeReply(ctx, "✅ Режим загрузки отменён.");
    }
  });

  // ============ КОНЕЦ АДМИН-КОМАНД ============

  // Text-based menu (hears)
  // Каталог убран из меню — покупки через мини-апп
  // bot.hears("🛍 Каталог", ...) removed
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
    const userId = String(ctx.from?.id ?? "");
    // C3: authorization — only the order's owner can cancel it (prevents abuse via forwarded messages).
    // FIX 2: fail-closed — if customerTg is null/missing, deny access instead of allowing it.
    const order = await db.order.findUnique({ where: { id: orderId }, select: { customerTg: true } });
    if (!order || String(order.customerTg ?? "") !== userId) {
      await ctx.answerCallbackQuery({ text: "Нет доступа к этому заказу" });
      return;
    }
    await cancelOrder(ctx, orderId);
    await ctx.answerCallbackQuery();
  });

  // Noop (disabled buttons)
  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Товара нет в наличии" });
  });

  // M1: dedicated "back to main menu" callback (replaces the misuse of "noop" in showReviews).
  bot.callbackQuery("back_to_menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.reply("Главное меню:", { reply_markup: mainMenuKeyboard() });
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
    await safeReply(
      ctx,
      "📋 *Правовая информация*\n\nВыберите документ для просмотра:",
      { reply_markup: kb }
    );
    await ctx.answerCallbackQuery();
  });

  // ---------- Смена виртуального номера ----------
  bot.callbackQuery(/^chgnum:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const userId = String(ctx.from?.id ?? "");
    const smsOrder = pendingSMSOrders.get(orderId);
    
    // C3: authorization — only the original buyer can change the number on their order.
    if (!smsOrder || smsOrder.tgId !== userId) {
      await ctx.answerCallbackQuery({ text: "Нет доступа к этому заказу" });
      return;
    }
    
    // Capture country BEFORE deleting from the map (default to 115/США if missing).
    const country = smsOrder.country ?? 115;
    // H1: capture previous generation BEFORE deleting so the new entry gets gen+1.
    const prevGen = smsOrder.gen ?? 0;
    
    // Отменяем старый номер. M8: log the cancel error instead of silently swallowing it.
    try { await smsSetStatus(smsOrder.activationId, 8); } catch (e: any) {
      console.error("[chgnum] cancel old number failed:", e?.message || e);
    }
    pendingSMSOrders.delete(orderId);
    
    await ctx.answerCallbackQuery({ text: "🔄 Заказываю новый номер..." });
    
    // Заказываем новый номер
    try {
      const result = await smsOrderNumber("tg", country);
      // H1: increment generation counter so any in-flight pollSMS from the previous
      // number aborts itself instead of leaking duplicate SMS codes to the customer.
      pendingSMSOrders.set(orderId, {
        activationId: result.id,
        phone: result.phone,
        attempts: 0,
        chatId: ctx.chat?.id ?? 0,
        tgId: String(ctx.from?.id ?? ""),
        country: country,
        gen: prevGen + 1,
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
      
      await safeReply(
        ctx,
        `📱 *Новый номер заказан!*\n\n` +
        `📞 Номер: *${result.phone}*\n` +
        `⏳ Проверка SMS каждые 10 секунд...`,
        { reply_markup: kb }
      );
      
      // Запускаем polling
      pollSMS(orderId, ctx);
    } catch (e: any) {
      await safeReply(ctx, `❌ Ошибка: ${String(e?.message || e).slice(0, 200)}`);
    }
  });

  // ---------- Отмена виртуального номера ----------
  bot.callbackQuery(/^cancelnum:(.+)$/, async (ctx) => {
    const orderId = ctx.match[1];
    const userId = String(ctx.from?.id ?? "");
    const smsOrder = pendingSMSOrders.get(orderId);

    // C3: authorization — only the original buyer can cancel the number on their order.
    if (!smsOrder || smsOrder.tgId !== userId) {
      await ctx.answerCallbackQuery({ text: "Нет доступа к этому заказу" });
      return;
    }

    // M7: track whether the SMS provider actually accepted our cancel/complete call,
    // so we don't lie to the customer that "номер возвращён на сервис" when it wasn't.
    let released = false;
    // Пробуем отменить (status=8), если не выйдет — завершаем (status=6)
    try {
      const cancelResult = await smsSetStatus(smsOrder.activationId, 8);
      console.log("[SMS] cancel result:", cancelResult);
      if (cancelResult.includes("DENIED") || cancelResult.includes("ERROR")) {
        // Если отмена не удалась — завершаем
        const completeResult = await smsSetStatus(smsOrder.activationId, 6);
        console.log("[SMS] fallback complete result:", completeResult);
        if (!completeResult.includes("DENIED") && !completeResult.includes("ERROR")) {
          released = true;
        }
      } else {
        released = true;
      }
    } catch (e: any) {
      console.error("[SMS] cancel error:", e?.message || e);
      // Пробуем завершить
      try {
        const completeResult = await smsSetStatus(smsOrder.activationId, 6);
        if (!completeResult.includes("DENIED") && !completeResult.includes("ERROR")) {
          released = true;
        }
      } catch (e2: any) {
        console.error("[SMS] fallback complete error:", e2?.message || e2);
      }
    }
    pendingSMSOrders.delete(orderId);
    
    // Отменяем заказ
    await db.order.update({ where: { id: orderId }, data: { status: "cancelled" } });
    
    await ctx.answerCallbackQuery({ text: "❌ Отменено" });
    if (released) {
      await safeReply(
        ctx,
        "✅ Заказ отменён. Номер возвращён на сервис.\n\n" +
        "Если возникли вопросы — нажмите 💬 Поддержка.",
        { reply_markup: mainMenuInline() }
      );
    } else {
      // M7: don't mislead — tell the customer the number may not have been released.
      await safeReply(
        ctx,
        `⚠️ Не удалось автоматически вернуть номер. Обратитесь в поддержку с ID: ${smsOrder.activationId}`,
        { reply_markup: mainMenuInline() }
      );
    }
  });

  // ---------- Получение кода входа для аккаунтов ----------
  bot.callbackQuery(/^getcode:(.+)$/, async (ctx) => {
    const itemId = ctx.match[1];
    const userId = String(ctx.from?.id ?? "");
    try {
      // Находим orderItem и связанный StockItem
      const orderItem = await db.orderItem.findUnique({
        where: { id: itemId },
        include: { order: { select: { customerTg: true } } },
      });
      if (!orderItem || !orderItem.delivered) {
        await ctx.answerCallbackQuery({ text: "Заказ не найден" });
        return;
      }
      // C3: authorization — only the original buyer can request a login code for their account.
      // FIX 2: fail-closed — if customerTg is null/missing, deny access instead of allowing it.
      if (String(orderItem.order?.customerTg ?? "") !== userId) {
        await ctx.answerCallbackQuery({ text: "Нет доступа к этому заказу" });
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
      // FIX M-3: scope by productId so a phone that legitimately exists in two
      // different account products resolves to the right StockItem (the one tied
      // to this order's product), not the first match across the whole table.
      const stockItem = await db.stockItem.findFirst({
        where: { phone, productId: orderItem.productId },
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
        await safeReply(
          ctx,
          `📱 *Код входа получен!*\n\n` +
          `🔑 *Код:* \`${result.code}\`\n` +
          `⏰ Получен: ${time}\n\n` +
          `Введите этот код в Telegram для входа в аккаунт.\n\n` +
          `⚠️ Код действителен ограниченное время.\n` +
          `Если не подошёл — нажмите «📱 Получить код» ещё раз.`,
          { reply_markup: new InlineKeyboard().text("📱 Получить код заново", `getcode:${itemId}`).row().text("💬 Поддержка", "support") }
        );
      } else {
        await safeReply(
          ctx,
          `⚠️ *Не удалось получить код*\n\n` +
          `Причина: ${result.error || "неизвестная"}\n\n` +
          `Возможные причины:\n` +
          `• Telegram ещё не прислал SMS (подождите 30 сек и попробуйте снова)\n` +
          `• Session файл недействителен\n` +
          `• Нет доступа к аккаунту\n\n` +
          `Попробуйте ещё раз через 30 секунд.`,
          { reply_markup: new InlineKeyboard().text("🔄 Попробовать снова", `getcode:${itemId}`).row().text("💬 Поддержка", "support") }
        );
      }
    } catch (e: any) {
      console.error("getcode error:", e);
      // C4: e.message may not exist (non-Error throws); coerce to string safely.
      await ctx.answerCallbackQuery({ text: "Ошибка: " + String(e?.message || e).slice(0, 100) });
    }
  });

  // ---------- Admin upload handler + SMM link handler ----------
  bot.on("message:text", async (ctx) => {
    const userId = String(ctx.from?.id ?? "");
    
    // 1. Проверяем запрос ссылки для накрутки (для любого пользователя)
    // C1: pendingLinkRequests is now keyed by orderId — iterate to find this user's entry.
    let foundOrderId: string | null = null;
    let req: { orderId: string; productTitle: string; smmServiceKey: string; smmServiceId: string; quantity: number; tgId: string } | null = null;
    for (const [orderId, r] of pendingLinkRequests) {
      if (r.tgId === userId) {
        foundOrderId = orderId;
        req = r;
        break;
      }
    }
    if (req && foundOrderId) {
      const link = ctx.message.text.trim();
      
      if (link.startsWith("/") || link.length < 5) {
        return; // команда, пропускаем
      }
      
      // Простая валидация ссылки
      if (!link.match(/^(https?:\/\/t\.me\/|@)/i)) {
        await safeReply(
          ctx,
          "❌ Неверный формат ссылки.\n\n" +
          "Пришлите ссылку в формате:\n" +
          "• @username канала\n" +
          "• https://t.me/username\n" +
          "• https://t.me/username/123 (для поста)"
        );
        return;
      }
      
      // H4: re-fetch order status — if the user already cancelled (or paid-then-completed somehow),
      // don't fire off a new SMM order on their behalf.
      const fresh = await db.order.findUnique({ where: { id: req.orderId }, select: { status: true } });
      if (!fresh || fresh.status !== "paid") {
        await safeReply(ctx, "Заказ уже обработан или отменён.");
        pendingLinkRequests.delete(foundOrderId);
        return;
      }

      // FIX 3: do NOT delete pendingLinkRequests yet — only delete AFTER smmCreateOrder
      // succeeds. If we delete first and smmCreateOrder throws/errors, the user is stuck
      // (can't retry by re-sending the link). Keep the entry so they can retry.
      await safeReply(ctx, "⏳ Создаю заказ на накрутку...");

      // Заказываем через SMM API
      const result = await smmCreateOrder(req.smmServiceId, link, req.quantity);

      if ("error" in result) {
        // DON'T delete pendingLinkRequests — user can retry by sending the link again.
        await safeReply(
          ctx,
          `⚠️ Не удалось создать заказ накрутки: ${escapeMd(result.error)}\n\nПопробуйте отправить ссылку ещё раз или обратитесь в поддержку.`,
          { reply_markup: mainMenuInline() }
        );
        return;
      }

      // Success — now safe to remove the pending entry.
      pendingLinkRequests.delete(foundOrderId);

      // Обновляем заказ — записываем SMM order ID
      await db.orderItem.updateMany({
        where: { orderId: req.orderId },
        data: { delivered: `🚀 Заказ запущен!\nSMM Order: #${result.orderId}\nУслуга: ${req.productTitle}\nКоличество: ${req.quantity}\nСсылка: ${link}\nСтатус: In progress` },
      });

      // SMM order was created successfully — now (and only now) mark the order as completed.
      // (Earlier the order was set to "paid" while waiting for the buyer's link.)
      await db.order.update({ where: { id: req.orderId }, data: { status: "completed" } });

      // H3: record the sale (product.salesCount + customer.totalSpent/ordersCount).
      // deliverOrder() is NOT called on the boost path, so we have to bump these manually.
      try {
        // Fetch the order with items so recordSale can read customerId/total/firstItem.productId.
        const saleOrder = await db.order.findUnique({
          where: { id: req.orderId },
          include: { items: true },
        });
        if (saleOrder) {
          const firstItem = saleOrder.items[0];
          if (firstItem) await recordSale(saleOrder, firstItem.productId, 1);
        }
      } catch (e: any) {
        console.error("[boost] recordSale error:", e?.message || e);
      }

      await safeReply(
        ctx,
        `✅ *Заказ на накрутку запущен!*\n\n` +
        `📋 Номер заказа: *${req.orderId.slice(-8).toUpperCase()}*\n` +
        `🔢 SMM Order: #${result.orderId}\n` +
        `📦 Услуга: ${escapeMd(req.productTitle)}\n` +
        `📊 Количество: ${req.quantity}\n` +
        `🔗 Ссылка: ${escapeMd(link)}\n\n` +
        `⏰ Накрутка выполняется в фоне. Обычно занимает от 30 минут до 24 часов.\n\n` +
        `Проверить статус: /orders`,
        { reply_markup: mainMenuInline() }
      );

      // Уведомление админу
      const adminId = process.env.ADMIN_TG_ID?.trim();
      if (adminId) {
        try {
          await safeSendMessage(ctx.api, adminId,
            `🔔 *Новый заказ на накрутку*\n\n` +
            `👤 Клиент: ${escapeMd(ctx.from?.first_name || "Unknown")} (${userId})\n` +
            `📋 Заказ: ${req.orderId.slice(-8).toUpperCase()}\n` +
            `🔢 SMM: #${result.orderId}\n` +
            `📦 Услуга: ${escapeMd(req.productTitle)}\n` +
            `📊 Кол-во: ${req.quantity}\n` +
            `🔗 Ссылка: ${escapeMd(link)}`
          );
        } catch (e) { console.error("Admin notify error:", e); }
      }
      return;
    }
    
    // 2. Admin upload handler
    const adminId = process.env.ADMIN_TG_ID?.trim();
    if (!adminId || userId !== adminId || !pendingUploads.has(userId)) {
      // M2: unmatched text — show the main menu so the user isn't left in silence.
      await ctx.reply("Используйте меню ниже 👇", { reply_markup: mainMenuKeyboard() });
      return;
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
    
    await safeReply(
      ctx,
      `✅ Готово!\n\nДобавлено: ${added} аккаунтов\nТовар: ${escapeMd(upload.productTitle)}\nВсего на складе: ${totalStock}\n\nИспользуйте /addstock ${upload.productId} для ещё одной загрузки`
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
      // FIX 1: persist the Telegram Stars charge id so we can refund it later
      // (cancelOrder path + /refund admin command). Idempotent — safe to re-set on retries.
      const chargeId = sp.telegram_payment_charge_id;
      if (chargeId && order.starPaymentChargeId !== chargeId) {
        try {
          await db.order.update({ where: { id: order.id }, data: { starPaymentChargeId: chargeId } });
          order.starPaymentChargeId = chargeId;
        } catch (e: any) {
          console.error("[tg-bot] successful_payment: failed to persist starPaymentChargeId:", e?.message || e);
        }
      }
      if (order.status === "completed") {
        await safeReply(ctx, `✅ Этот заказ (${escapeMd(order.number)}) уже оплачен и доставлен.`);
        return;
      }

      const tgId = String(ctx.from?.id ?? "");
      const firstItem = order.items[0];
      if (!firstItem) {
        console.error("[tg-bot] successful_payment: order has no items", order.id);
        await safeReply(ctx, "⚠️ Заказ не содержит товаров. Обратитесь в поддержку.");
        return;
      }
      // Include category so we can detect product type robustly (slug keywords alone are fragile).
      const product = await db.product.findUnique({
        where: { id: firstItem.productId },
        include: { category: true },
      });
      
      if (!product) {
        await safeReply(ctx, "⚠️ Товар не найден. Обратитесь в поддержку.");
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
        // FIX H-1: idempotency — if a duplicate successful_payment arrives (Telegram
        // sometimes retries), don't re-order a second SMS number on top of the first.
        if (pendingSMSOrders.has(order.id)) {
          await safeReply(ctx, "⏳ Номер уже заказан, ожидайте SMS-код.");
          return;
        }
        // Определяем предпочитаемую страну по товару, но при NO_NUMBERS fallback на другие.
        const COUNTRY_FALLBACK_CHAIN = [6, 16, 115, 34, 93]; // Индонезия, Великобритания, США, Канада, Португалия
        let preferredCountry = 115;
        const countryMatch = product.longDesc?.match(/Страна: ID (\d+)/);
        if (countryMatch) {
          const parsed = parseInt(countryMatch[1], 10);
          if (Number.isFinite(parsed)) preferredCountry = parsed;
        } else {
          if (product.title.includes("Индонез")) preferredCountry = 6;
          else if (product.title.includes("Канад")) preferredCountry = 34;
          else if (product.title.includes("США") || product.title.includes("USA")) preferredCountry = 115;
          else if (product.title.includes("Великобритан") || product.title.includes("UK")) preferredCountry = 16;
          else if (product.title.includes("Португал")) preferredCountry = 93;
        }
        // Fallback chain: начинаем с preferred, потом остальные
        const tryCountries = [preferredCountry, ...COUNTRY_FALLBACK_CHAIN.filter(c => c !== preferredCountry)];
        
        let result: { id: number; phone: string } | null = null;
        let lastError = "";
        let usedCountry = preferredCountry;
        for (const c of tryCountries) {
          try {
            console.log(`[SMS] trying country=${c} for order ${order.id}`);
            result = await smsOrderNumber("tg", c);
            usedCountry = c;
            break;
          } catch (e: any) {
            const msg = String(e?.message || e);
            lastError = msg;
            console.log(`[SMS] country=${c} failed: ${msg}`);
            if (msg.includes("NO_NUMBERS") || msg.includes("Нет доступных номеров")) continue;
            // NO_BALANCE или другая ошибка — нет смысла пробовать дальше
            break;
          }
        }
        
        if (!result) {
          // Не удалось заказать номер ни из одной страны → refund Stars автоматически
          console.error("[tg-bot] SMS order failed for all countries. Last error:", lastError);
          // Уведомить админа
          const adminId = process.env.ADMIN_TG_ID?.trim();
          if (adminId && bot) {
            try {
              await bot.api.sendMessage(adminId,
                `🚨 *Нет номеров на smsfast.vip!*\n\n` +
                `Заказ: ${order.number}\n` +
                `Пользователь: ${tgId}\n` +
                `Последняя ошибка: ${lastError.slice(0, 150)}\n\n` +
                `Проверьте наличие номеров на https://smsfast.vip или пополните баланс.`,
                { parse_mode: "Markdown" });
            } catch {}
          }
          // Авто-refund Stars
          if (order.starPaymentChargeId && tgId) {
            try {
              await bot!.api.refundStarPayment(Number(tgId), order.starPaymentChargeId);
              await db.order.update({ where: { id: order.id }, data: { status: "refunded" } });
              await safeReply(ctx,
                `⚠️ Не удалось заказать номер (нет доступных на сервисе).\n\n` +
                `✅ Stars автоматически возвращены на ваш аккаунт.\n` +
                `Попробуйте позже или выберите другую страну.`,
                { reply_markup: mainMenuInline() });
            } catch (refundErr: any) {
              console.error("[SMS] refund failed:", refundErr?.message || refundErr);
              await db.order.update({ where: { id: order.id }, data: { status: "cancelled", note: "no numbers + refund failed" } });
              await safeReply(ctx,
                `⚠️ Не удалось заказать номер. Обратитесь в поддержку с номером заказа ${order.number} для возврата Stars.`,
                { reply_markup: mainMenuInline() });
            }
          } else {
            await db.order.update({ where: { id: order.id }, data: { status: "cancelled", note: "no numbers available" } });
            await safeReply(ctx,
              `⚠️ Не удалось заказать номер. Обратитесь в поддержку с номером заказа ${order.number}.`,
              { reply_markup: mainMenuInline() });
          }
          return;
        }
        
        try {
          // H1: initial gen = 0.
          pendingSMSOrders.set(order.id, {
            activationId: result.id,
            phone: result.phone,
            attempts: 0,
            chatId: ctx.chat?.id ?? 0,
            tgId: tgId,
            country: usedCountry,
            gen: 0,
          });
          
          await db.orderItem.updateMany({
            where: { orderId: order.id },
            data: { delivered: `phone: ${result.phone}\nID: ${result.id}\n⏳ Ожидание SMS-кода...` },
          });
          
          // H2: do NOT mark as completed yet — wait until the SMS code actually arrives
          await db.order.update({ where: { id: order.id }, data: { status: "paid" } });
          
          const kb = new InlineKeyboard()
            .text("🔄 Сменить номер", `chgnum:${order.id}`)
            .row()
            .text("❌ Отменить", `cancelnum:${order.id}`);
          
          await safeReply(
            ctx,
            `📱 *Виртуальный номер заказан!*\n\n` +
            `📞 Номер: *${result.phone}*\n` +
            `🔧 ID: ${result.id}\n\n` +
            `1. Введите этот номер в Telegram\n` +
            `2. Дождитесь SMS с кодом\n` +
            `3. Бот автоматически пришлёт код\n\n` +
            `_Если код не придёт за 10 минут — нажмите «🔄 Сменить номер»_`,
            { reply_markup: kb }
          );
          
          pollSMS(order.id, ctx);
        } catch (e: any) {
          console.error("[tg-bot] SMS order error:", e);
          await safeReply(
            ctx,
            `⚠️ Не удалось заказать номер: ${String(e?.message || e).slice(0, 200)}\n\nОбратитесь в поддержку.`,
            { reply_markup: mainMenuInline() }
          );
        }
        return;
      }

      if (isBoost) {
        // === НАКРУТКА ===
        // FIX H-1: idempotency — if a duplicate successful_payment arrives, don't
        // overwrite the existing pendingLinkRequests entry (would lose state).
        if (pendingLinkRequests.has(order.id)) {
          await safeReply(ctx, "⏳ Уже жду ссылку от вас. Пришлите ссылку на пост/канал.");
          return;
        }
        let smmServiceKey = "";
        let quantity = 0;
        if (product.title.includes("10000") && product.title.includes("просмотр")) { smmServiceKey = "tg-views-10000"; quantity = 10000; }
        else if (product.title.includes("50000") && product.title.includes("просмотр")) { smmServiceKey = "tg-views-50000"; quantity = 50000; }
        else if (product.title.includes("1000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-1000"; quantity = 1000; }
        else if (product.title.includes("5000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-5000"; quantity = 5000; }
        else if (product.title.includes("10000") && product.title.includes("подписчик")) { smmServiceKey = "tg-subs-10000"; quantity = 10000; }
        else if (product.title.includes("1000") && product.title.includes("реакц")) { smmServiceKey = "tg-react-1000"; quantity = 1000; }
        else if (product.title.includes("150") && product.title.includes("реакц")) { smmServiceKey = "tg-react-150"; quantity = 150; }
        else if (product.title.includes("100") && product.title.includes("реакц")) { smmServiceKey = "tg-react-100"; quantity = 100; }
        else if (product.title.includes("50") && product.title.includes("реакц")) { smmServiceKey = "tg-react-50"; quantity = 50; }
        
        if (smmServiceKey && SMM_SERVICES[smmServiceKey]) {
          // C1: key by order.id (not tgId) so a second boost order can't overwrite the first.
          pendingLinkRequests.set(order.id, {
            orderId: order.id,
            productTitle: product.title,
            smmServiceKey,
            smmServiceId: SMM_SERVICES[smmServiceKey].serviceId,
            quantity,
            tgId: tgId,
          });
          
          await db.orderItem.updateMany({
            where: { orderId: order.id },
            data: { delivered: "⏳ Ожидает ссылку для накрутки..." },
          });
          
          // Order is paid but NOT yet completed — completion happens only after
          // the buyer sends a link AND smmCreateOrder succeeds (see link-handler above).
          await db.order.update({ where: { id: order.id }, data: { status: "paid" } });
          
          await safeReply(
            ctx,
            `🚀 *Заказ на накрутку оплачен!*\n\n` +
            `Услуга: *${escapeMd(product.title)}*\n` +
            `Номер: *${escapeMd(order.number)}*\n\n` +
            `📌 *Пришлите ссылку на канал или пост:*\n` +
            `• Для подписчиков: @username или https://t.me/канал\n` +
            `• Для просмотров: https://t.me/канал/123\n` +
            `• Для реакций: https://t.me/канал/123\n\n` +
            `_Накрутка начнётся автоматически после получения ссылки._`
          );
        } else {
          await safeReply(
            ctx,
            `⚠️ Услуга не найдена в SMM системе. Обратитесь в поддержку.\n\nЗаказ: ${escapeMd(order.number)}`,
            { reply_markup: mainMenuInline() }
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
      // FIX L-2: don't non-null assert — if the order vanished (concurrent delete / DB
      // hiccup) between deliverOrder and now, log it and bail instead of crashing the
      // handler with a TypeError.
      if (!fresh) {
        console.error("[tg-bot] successful_payment: order disappeared after delivery", order.id);
        return;
      }
      await sendDeliveryMessage(ctx, fresh);
    } catch (e: any) {
      console.error("[tg-bot] successful_payment error:", e);
      // Показываем номер заказа и краткую ошибку — так поддержка сможет быстро помочь.
      const orderNum = (() => { try { const p = JSON.parse(ctx.message?.successful_payment?.invoice_payload || "{}"); return p.orderId || ""; } catch { return ""; } })();
      let orderNumber = "неизвестен";
      if (orderNum) {
        try { const o = await db.order.findUnique({ where: { id: orderNum }, select: { number: true } }); if (o) orderNumber = o.number; } catch {}
      }
      await safeReply(
        ctx,
        `⚠️ Ошибка при выдаче товара.\n\n` +
        `Заказ: *${orderNumber}*\n` +
        `Причина: ${String(e?.message || e).slice(0, 200)}\n\n` +
        `Напишите в поддержку с этим номером заказа.`
      );
    }
  });

  // Автопроверка SMM-заказов каждые 5 минут.
  // Each getOrderStatus call is wrapped in try/catch so one failure doesn't kill the loop.
  setInterval(async () => {
    try {
      // H7: release stale (unpaid >30min) stock reservations so they don't pile up.
      await releaseStaleReservations();

      // Platega poll — проверяем pending заказы с plategaTransactionId.
      // Backup на случай если Platega webhook не настроен/не работает.
      try {
        await pollPlategaPayments();
      } catch (e: any) {
        console.error("[platega-poll] error:", e?.message || e);
      }

      // Virtual number poll — для заказов оплаченных картой (через Platega),
      // бот должен заказать номер через smsfast.vip и запустить pollSMS.
      // Stars-платежи обрабатываются в successful_payment handler, но card-платежи
      // идут через Next.js webhook и бот о них не знает — поэтому poller.
      try {
        await processPendingCardPaidVirtualNumbers();
      } catch (e: any) {
        console.error("[virtual-poll] error:", e?.message || e);
      }

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
          // C2: skip both Completed AND Partial variants — the previous check only matched
          // the "✅ Накрутка выполнена" label, so Partial orders (label "⚠️ Накрутка выполнена
          // частично") were re-appended every 5 min → customer spam + unbounded DB growth.
          if (it.delivered.includes("Накрутка выполнена")) continue;
          if (it.delivered.includes("Накрутка отменена")) continue;
          
          const smmMatch = it.delivered.match(/SMM Order: #(\d+)/);
          if (!smmMatch) continue;
          const smmId = parseInt(smmMatch[1], 10);
          if (!Number.isFinite(smmId)) continue;
          
          let status;
          try {
            status = await getOrderStatus(smmId);
          } catch (e: any) {
            console.error(`[smm-poll] getOrderStatus error for SMM #${smmId}:`, e?.message || e);
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
                await safeSendMessage(bot!.api, o.customerTg,
                  `✅ *Накрутка выполнена!*\n\nЗаказ ${escapeMd(o.number)}\nSMM #${smmId}\nСтатус: ${s}\n\nСпасибо за покупку! 🙏\nОставьте отзыв: /reviews`
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
                await safeSendMessage(bot!.api, o.customerTg,
                  `❌ *Накрутка отменена*\n\nЗаказ ${escapeMd(o.number)}\nSMM #${smmId}\n\nОбратитесь в поддержку для возврата.`
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
        // FIX B-1: recover in-memory pending-order state from the DB so a bot restart
        // doesn't strand paid virtual-number / boost orders.
        recoverPendingOrders().catch((e) => {
          console.error("[recovery] top-level error:", e?.message || e);
        });
      },
    });
  } catch (e) {
    console.error("[tg-bot] bot.start() failed:", e);
  } finally {
    // M10: ensure botRunning flips back to false even if start() throws/rejects,
    // so the health endpoint stops reporting "running" for a dead bot.
    botRunning = false;
  }
}

// ---------- SMS Polling ----------
async function pollSMS(orderId: string, ctx: any) {
  const smsOrder = pendingSMSOrders.get(orderId);
  if (!smsOrder) return;
  // H1: capture this poll's generation. If chgnum fires while we're sleeping, the entry
  // gets a new gen — we'll detect the mismatch on the next iteration and abort so we
  // don't deliver a stale SMS code (or a duplicate after the new number arrives).
  const myGen = smsOrder.gen;
  
  const maxAttempts = 90; // 90 попыток × 10 сек = 15 минут (smsfast.vip отменяет через ~20 мин)
  
  for (let i = 0; i < maxAttempts; i++) {
    const current = pendingSMSOrders.get(orderId);
    // H1: abort if the entry was deleted (cancel) or bumped to a new gen (chgnum).
    if (!current || current.gen !== myGen) return;
    
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
        
        // H2: now that the SMS code has actually arrived, mark the order completed.
        // (Earlier the order was set to "paid" by the successful_payment handler.)
        try {
          await db.order.update({ where: { id: orderId }, data: { status: "completed" } });
        } catch (e: any) {
          console.error("[pollSMS] mark completed error:", e?.message || e);
        }
        
        // H3: record the sale (product.salesCount + customer.totalSpent/ordersCount).
        try {
          const saleOrder = await db.order.findUnique({
            where: { id: orderId },
            include: { items: true },
          });
          if (saleOrder) {
            const firstItem = saleOrder.items[0];
            if (firstItem) await recordSale(saleOrder, firstItem.productId, 1);
          }
        } catch (e: any) {
          console.error("[pollSMS] recordSale error:", e?.message || e);
        }
        
        // Отправляем код покупателю
        const kb = new InlineKeyboard()
          .text("💬 Поддержка", "support")
          .row()
          .text("⭐ Оставить отзыв", "reviews");

        // Для card-paid заказов chatId=0 — используем tgId как fallback
        const sendTo = current.chatId || (current.tgId ? Number(current.tgId) : 0);
        if (sendTo > 0) {
          await safeSendMessage(ctx.api, sendTo,
            `✅ *SMS-код получен!*\n\n` +
            `📱 Номер: ${phone}\n` +
            `🔑 *Код: ${status.code}*\n\n` +
            `Введите этот код в Telegram для входа.\n\n` +
            `_Код действителен ограниченное время._`,
            { reply_markup: kb }
          );
        }
        return;
      }
      
      if (status.status === "cancel") {
        pendingSMSOrders.delete(orderId);
        // smsfast.vip отменил номер (например, не дождались SMS) → авто-refund Stars
        let refunded = false;
        try {
          const ord = await db.order.findUnique({ where: { id: orderId }, select: { number: true, starPaymentChargeId: true, customerTg: true } });
          if (ord?.starPaymentChargeId && ord.customerTg) {
            try {
              await bot!.api.refundStarPayment(Number(ord.customerTg), ord.starPaymentChargeId);
              await db.order.update({ where: { id: orderId }, data: { status: "refunded" } });
              refunded = true;
            } catch (re: any) {
              console.error("[pollSMS] cancel-refund failed:", re?.message || re);
            }
          }
        } catch (e: any) {
          console.error("[pollSMS] cancel-refund lookup failed:", e?.message || e);
        }
        const sendToCancel = current.chatId || (current.tgId ? Number(current.tgId) : 0);
        if (sendToCancel > 0) {
          if (refunded) {
            await safeSendMessage(ctx.api, sendToCancel,
              "❌ Номер был отменён сервисом (код не пришёл вовремя).\n\n✅ Stars автоматически возвращены. Попробуйте другую страну.",
              { reply_markup: new InlineKeyboard().text("🔄 Сменить номер", `chgnum:${orderId}`) }
            );
          } else {
            await safeSendMessage(ctx.api, sendToCancel,
              "❌ Номер был отменён. Используйте «🔄 Сменить номер» для заказа нового.",
              { reply_markup: new InlineKeyboard().text("🔄 Сменить номер", `chgnum:${orderId}`) }
            );
          }
        }
        return;
      }
    } catch (e: any) {
      console.error("[tg-bot] SMS poll error:", e?.message || e);
    }
    
    // Ждём 10 секунд
    await new Promise(r => setTimeout(r, 10000));
  }
  
  // Таймаут — код не пришёл за 15 минут
  const current = pendingSMSOrders.get(orderId);
  if (current && current.gen === myGen) {
    pendingSMSOrders.delete(orderId);
    // Отменяем номер на сервисе
    try { await smsSetStatus(current.activationId, 8); } catch (e: any) {
      console.error("[pollSMS] timeout cancel error:", e?.message || e);
    }
    
    // Авто-refund Stars при таймауте — код так и не пришёл, покупатель не виноват.
    let refunded = false;
    try {
      const order = await db.order.findUnique({ where: { id: orderId }, select: { number: true, starPaymentChargeId: true, customerTg: true } });
      if (order?.starPaymentChargeId && order.customerTg) {
        try {
          await bot!.api.refundStarPayment(Number(order.customerTg), order.starPaymentChargeId);
          await db.order.update({ where: { id: orderId }, data: { status: "refunded" } });
          refunded = true;
          console.log(`[pollSMS] auto-refund OK for order ${order.number}`);
        } catch (re: any) {
          console.error("[pollSMS] auto-refund failed:", re?.message || re);
        }
      }
    } catch (e: any) {
      console.error("[pollSMS] refund lookup failed:", e?.message || e);
    }
    
    const sendToTimeout = current.chatId || (current.tgId ? Number(current.tgId) : 0);
    if (sendToTimeout > 0) {
      if (refunded) {
        await safeSendMessage(ctx.api, sendToTimeout,
          "⏰ *Время ожидания истекло*\n\n" +
          "SMS-код не был получен за 15 минут.\n" +
          "✅ Stars автоматически возвращены на ваш аккаунт.\n" +
          "Попробуйте заказать номер другой страны.",
          { reply_markup: new InlineKeyboard().text("🔄 Сменить номер", `chgnum:${orderId}`) }
        );
      } else {
        await safeSendMessage(ctx.api, sendToTimeout,
          "⏰ *Время ожидания истекло*\n\n" +
          "SMS-код не был получен за 15 минут.\n" +
          "Нажмите «🔄 Сменить номер» для заказа нового номера, или обратитесь в поддержку для возврата Stars.",
          { reply_markup: new InlineKeyboard().text("🔄 Сменить номер", `chgnum:${orderId}`) }
        );
      }
    }
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
  
  await safeReply(ctx, text);
}

// ---------- Catalog flow ----------
async function showCategories(ctx: any) {
  const categories = await db.category.findMany({
    orderBy: { sortOrder: "asc" },
    include: { products: { where: { active: true }, select: { id: true } } },
  });

  if (categories.length === 0) {
    await safeReply(
      ctx,
      "Категории пока не добавлены. Загляните позже 🌱",
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  const kb = new InlineKeyboard();
  for (const c of categories) {
    kb.text(`${c.icon || "📁"} ${escapeMd(c.name)} (${c.products.length})`, `cat:${c.id}`).row();
  }

  await safeReply(
    ctx,
    "🛍 *Каталог*\nВыберите категорию:",
    { reply_markup: kb }
  );
}

async function showProductsInCategory(ctx: any, categoryId: string) {
  // H7: release stale reservations up-front so stock counts shown here are accurate.
  await releaseStaleReservations();
  const products = await db.product.findMany({
    where: { categoryId, active: true },
    orderBy: { salesCount: "desc" },
  });

  if (products.length === 0) {
    const kb = new InlineKeyboard().text("⬅️ Назад", "back_to_cats");
    await safeReply(ctx, "В этой категории пока нет товаров.", { reply_markup: kb });
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
      `*${escapeMd(p.title)}*\n` +
      `${escapeMd(p.description)}\n\n` +
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
    await safeReply(ctx, text, { reply_markup: kb });
  }
}

// ---------- Stars flow ----------
async function showStars(ctx: any) {
  const products = await db.product.findMany({
    where: { type: "stars", active: true },
    orderBy: { price: "asc" },
  });

  if (products.length === 0) {
    await safeReply(
      ctx,
      "⭐ Звёзды пока не добавлены в каталог. Загляните позже!",
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  await safeReply(ctx, "⭐ *Покупка Telegram Звёзд*\nВыберите пакет:");

  for (const p of products) {
    const stock = await db.stockItem.count({
      where: { productId: p.id, status: "available" },
    });
    // M11: stars products are delivered via Telegram Stars payment, not from StockItem —
    // don't hide them just because StockItem count is 0.
    if (p.type !== "stars" && stock <= 0) continue;
    const ratingLine = p.rating > 0 ? `${stars(p.rating)} ${p.rating.toFixed(1)}` : "";
    const text =
      `*${escapeMd(p.title)}*\n` +
      `${escapeMd(p.description)}\n` +
      `💰 ${formatPrice(p.price, p.currency)}` +
      (ratingLine ? `\n${ratingLine}` : "") +
      `\n📦 В наличии: ${stock}`;
    const kb = new InlineKeyboard().text("🛒 Купить", `buy:${p.id}`);
    await safeReply(ctx, text, { reply_markup: kb });
  }
}

// ---------- Orders flow ----------
async function showOrders(ctx: any) {
  const tgId = String(ctx.from?.id ?? "");
  if (!tgId) {
    await safeReply(ctx, "Не удалось определить ваш Telegram ID.", {
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
    await safeReply(
      ctx,
      "📦 У вас пока нет заказов.\nОткройте каталог, чтобы сделать первый заказ 🛍",
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  await safeReply(ctx, "📦 *Ваши последние заказы:*");

  for (const o of orders) {
    const itemsLine = o.items
      .map((i: any) => `• ${escapeMd(i.title)} ×${i.qty} — ${formatPrice(i.price * i.qty, o.currency)}`)
      .join("\n");
    const text =
      `*${escapeMd(o.number)}*\n` +
      `${orderStatusLabel(o.status)}\n` +
      `💳 Сумма: ${formatPrice(o.total, o.currency)}\n` +
      `📅 ${formatDate(o.createdAt)}\n` +
      (itemsLine ? `\n${itemsLine}` : "");

    const kb = new InlineKeyboard();
    // FIX H-3: completed account orders — show a "📱 Получить код" button so the buyer
    // can fetch the Telegram login code from the stored session without re-running the
    // full delivery message flow.
    if (o.status === "completed") {
      const hasAccount = o.items.some(it => it.delivered && (it.delivered.includes("phone:") || it.delivered.includes("session: stored-in-db")));
      if (hasAccount) {
        const accountItem = o.items.find(it => it.delivered?.includes("phone:")) ?? o.items.find(it => it.delivered?.includes("session: stored-in-db"));
        if (accountItem) {
          kb.text("📱 Получить код", `getcode:${accountItem.id}`).row();
        }
      }
    }
    if (o.status === "pending") {
      // NOTE: the "✅ Оплатил" button was removed — it bypassed payment and delivered for free.
      // Users pay via the Stars invoice sent at order creation. If they lost it, they cancel and re-order.
      kb.text("❌ Отменить", `cancel_order:${o.id}`);
    }
    // H6: in case an order has many items and the text overruns 4096 chars, chunk it.
    await safeReplyLong(ctx, text, { reply_markup: kb });
  }
}

// ---------- Support ----------
async function showSupport(ctx: any) {
  const s = await getSettings();
  const contact = s.supportContact || "@support";
  const text =
    `💬 *Поддержка*\n\n` +
    `Если у вас возникли вопросы по заказу, оплате или доставке — пишите:\n` +
    `${escapeMd(contact)}\n\n` +
    `Мы отвечаем с 9:00 до 23:00 (МСК).`;
  await safeReply(ctx, text, {
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
        const starsStr = "⭐".repeat(r.rating);
        text += `${starsStr} *${escapeMd(r.author)}*\n`;
        text += `${escapeMd(r.text.slice(0, 100))}${r.text.length > 100 ? "..." : ""}\n`;
        if (r.product) text += `📦 _${escapeMd(r.product.title)}_\n`;
        text += `\n`;
      }
    } else {
      text += `Пока нет отзывов. Будьте первым!\n\n`;
    }
    
    text += `📝 *Читать все отзывы и оставить свой:*\n${reviewsUrl}`;

    const kb = new InlineKeyboard()
      .url("🌐 Открыть все отзывы", reviewsUrl)
      .row()
      // M1: dedicated back_to_menu callback (was "noop" which actually meant "товара нет в наличии").
      .text("⬅️ В меню", "back_to_menu");
    
    // H6: a long batch of reviews could push the message past 4096 chars — chunk it.
    await safeReplyLong(ctx, text, { reply_markup: kb });
  } catch (e: any) {
    console.error("[tg-bot] showReviews error:", e);
    await safeReply(ctx, "⚠️ Не удалось загрузить отзывы. Попробуйте позже.");
  }
}

// ---------- Open store ----------
async function openStore(ctx: any) {
  const s = await getSettings();
  const url = WEBAPP_URL || s.miniAppUrl || "";
  if (!url) {
    await safeReply(
      ctx,
      "🌐 Веб-приложение магазина пока не настроено.",
      { reply_markup: mainMenuKeyboard() }
    );
    return;
  }
  const kb = new InlineKeyboard().webApp("🛒 Открыть магазин", url);
  await safeReply(ctx, "🌐 Нажмите кнопку ниже, чтобы открыть магазин:", {
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

  // Check stock (skip services, virtual numbers, and stars — they don't use StockItem)
  if (product.type !== "service" && product.type !== "stars" && !product.slug.includes("nomer") && !product.slug.includes("number") && !product.slug.includes("virtual")) {
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

  // L1: retry on P2002 (unique-constraint collision on `number`) — genOrderNumber is
  // 8 random chars so collisions are rare but possible; regenerate up to 3 times.
  const orderData = {
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
  };
  let order: any;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      order = await db.order.create({
        data: { ...orderData, number: genOrderNumber() },
        include: { items: true },
      });
      break;
    } catch (e: any) {
      if (e?.code === "P2002" && attempt < 2) continue;
      throw e;
    }
  }
  if (!order) throw new Error("Не удалось создать заказ после 3 попыток");

  // Reserve stock / mark services
  for (const it of order.items) {
    if (product.type === "service") {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "🚀 Заказ принят в работу. Укажите ссылку на канал/пост в чате с поддержкой — старт в течение 1 часа." },
      });
      continue;
    }
    // FIX M-2: stars products are delivered via Telegram Stars payment (the buyer
    // simply pays the invoice and Stars are debited from their account), NOT from a
    // StockItem row. Skip stock reservation entirely so a 0-stock stars product can
    // still be purchased.
    if (product.type === "stars") {
      // Stars products delivered via Telegram Stars payment, not from StockItem
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
      await safeReply(ctx, `⚠️ ${String(e?.message || e).slice(0, 200)}\n\nЗаказ ${order.number} отменён.`, { reply_markup: mainMenuInline() });
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
        chat_id: ctx.chat?.id ?? 0,
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
    await safeReply(
      ctx,
      `🧾 Заказ *${escapeMd(order.number)}* создан.\n` +
      `Сумма: ${formatPrice(order.total, order.currency)} = *${starsAmount} ⭐*\n\n` +
      `Оплатите инвойс выше ⭐ — товар придёт автоматически.`,
      { reply_markup: mainMenuInline() }
    );
  } catch (e: any) {
    console.error("[tg-bot] sendInvoice error:", e);
    await safeReply(
      ctx,
      `⚠️ Не удалось создать счёт для оплаты. Попробуйте позже или напишите в поддержку.\n\nЗаказ: ${escapeMd(order.number)}`,
      { reply_markup: mainMenuInline() }
    );
  }
}

// ---------- Delivery core (used by successful_payment) ----------

// H3: recordSale — increments product.salesCount + customer.totalSpent/ordersCount.
// Used on the virtual-number and boost paths, where deliverOrder() is NOT called and
// therefore these counters were never updated (under-counting sales & spend).
async function recordSale(order: any, productId: string, qty: number) {
  try {
    await db.product.update({ where: { id: productId }, data: { salesCount: { increment: qty } } });
    if (order.customerId) {
      await db.customer.update({
        where: { id: order.customerId },
        data: { totalSpent: { increment: order.total }, ordersCount: { increment: 1 } },
      });
    }
  } catch (e: any) {
    console.error("[recordSale] error:", e?.message || e);
  }
}

// H7: releaseStaleReservations — cancel pending orders older than 30 min so their
// reserved StockItems are returned to "available" for other buyers. Called from the
// SMM poll setInterval (every 5 min) and at startup.
async function releaseStaleReservations() {
  try {
    const cutoff = new Date(Date.now() - 30 * 60 * 1000); // 30 min
    const stale = await db.order.findMany({
      where: { status: "pending", createdAt: { lt: cutoff } },
      select: { id: true },
    });
    for (const o of stale) {
      await db.stockItem.updateMany({
        where: { reservedOrderId: o.id, status: "reserved" },
        data: { status: "available", reservedOrderId: null },
      });
      await db.order.update({ where: { id: o.id }, data: { status: "cancelled", note: "auto-cancelled: unpaid timeout" } });
    }
    if (stale.length > 0) console.log(`[cleanup] released ${stale.length} stale reservations`);
  } catch (e: any) {
    console.error("[cleanup] releaseStaleReservations error:", e?.message || e);
  }
}

// Platega payment poller — backup for webhook. Checks all pending orders with
// plategaTransactionId, queries Platega API for status, and delivers/cancels
// accordingly. Called from the SMM poll setInterval (every 5 min).
async function pollPlategaPayments() {
  const MERCHANT_ID = process.env.PLATEGA_MERCHANT_ID || "";
  const SECRET = process.env.PLATEGA_SECRET || "";
  if (!MERCHANT_ID || !SECRET) return; // Platega not configured

  const orders = await db.order.findMany({
    where: { status: "pending", plategaTransactionId: { not: null } },
    include: { items: true },
    take: 50,
  });
  if (orders.length === 0) return;

  console.log(`[platega-poll] checking ${orders.length} pending Platega orders`);
  let confirmed = 0, canceled = 0;

  for (const order of orders) {
    if (!order.plategaTransactionId) continue;
    try {
      const res = await fetch(`https://app.platega.io/transaction/${order.plategaTransactionId}`, {
        method: "GET",
        headers: {
          "X-MerchantId": MERCHANT_ID,
          "X-Secret": SECRET,
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        console.error(`[platega-poll] ${order.number}: HTTP ${res.status}`);
        continue;
      }
      const data = await res.json() as { status: string };
      const status = data.status;

      if (status === "CONFIRMED") {
        // Payment confirmed — mark paid, deliver goods
        await db.order.update({ where: { id: order.id }, data: { status: "paid" } });
        // Уведомить покупателя через бота (если возможно)
        if (bot && order.customerTg) {
          try {
            const chatId = Number(order.customerTg);
            if (Number.isFinite(chatId)) {
              await safeSendMessage(bot.api, chatId,
                `✅ *Оплата получена!*\n\nЗаказ *${order.number}* оплачен.\nТовар выдан в этом чате.`,
                { parse_mode: "Markdown" }
              );
            }
          } catch (e: any) {
            console.error(`[platega-poll] notify buyer failed:`, e?.message || e);
          }
        }
        // Доставка товара (для обычных товаров — сток; для service/virtual — метка)
        try {
          await deliverPlategaOrder(order.id);
          confirmed++;
          console.log(`[platega-poll] delivered ${order.number}`);
        } catch (e: any) {
          console.error(`[platega-poll] deliver ${order.number} failed:`, e?.message || e);
        }
      } else if (status === "CANCELED" || status === "CHARGEBACKED") {
        await db.stockItem.updateMany({
          where: { reservedOrderId: order.id },
          data: { status: "available", reservedOrderId: null },
        });
        await db.order.update({
          where: { id: order.id },
          data: { status: status === "CHARGEBACKED" ? "refunded" : "cancelled" },
        });
        canceled++;
        console.log(`[platega-poll] ${status} ${order.number}`);
      }
      // PENDING — still waiting
    } catch (e: any) {
      console.error(`[platega-poll] ${order.number} error:`, e?.message || e);
    }
  }
  if (confirmed > 0 || canceled > 0) {
    console.log(`[platega-poll] done: ${confirmed} confirmed, ${canceled} canceled`);
  }
}

// processPendingCardPaidVirtualNumbers — for orders paid via card (Platega) that
// contain a virtual number, the Next.js webhook marks them paid+completed but
// can't order the SMS number (only the bot can do that via smsfast.vip).
// This poller finds such orders and orders the number + starts pollSMS.
async function processPendingCardPaidVirtualNumbers() {
  // Find orders that are paid/completed via card, with delivered containing
  // "Номер будет заказан ботом" (the marker set by the webhook), AND not yet
  // in pendingSMSOrders (so we don't double-order).
  const orders = await db.order.findMany({
    where: {
      payMethod: "card",
      status: { in: ["paid", "completed"] },
      items: { some: { delivered: { contains: "Номер будет заказан ботом" } } },
    },
    include: { items: true },
    take: 20,
  });
  if (orders.length === 0) return;

  console.log(`[virtual-poll] found ${orders.length} card-paid virtual number orders to process`);

  for (const order of orders) {
    // Skip if already being polled (pollSMS in progress)
    if (pendingSMSOrders.has(order.id)) {
      console.log(`[virtual-poll] ${order.number}: already in pendingSMSOrders, skip`);
      continue;
    }

    const firstItem = order.items[0];
    if (!firstItem) continue;
    const product = await db.product.findUnique({
      where: { id: firstItem.productId },
      include: { category: true },
    });
    if (!product) continue;

    // Verify it's a virtual number
    const catSlug = product.category?.slug ?? "";
    const slugLower = product.slug.toLowerCase();
    const titleLower = product.title.toLowerCase();
    const isVirtual =
      catSlug === "virtual-numbers" ||
      slugLower.includes("nomer") || slugLower.includes("number") ||
      slugLower.includes("virtual") || slugLower.includes("sms") ||
      titleLower.includes("виртуальн") || titleLower.includes("номер");
    if (!isVirtual) continue;

    // Determine country (same logic as successful_payment handler)
    const COUNTRY_FALLBACK_CHAIN = [6, 16, 115, 34, 93];
    let preferredCountry = 115;
    if (product.title.includes("Индонез")) preferredCountry = 6;
    else if (product.title.includes("Канад")) preferredCountry = 34;
    else if (product.title.includes("США") || product.title.includes("USA")) preferredCountry = 115;
    else if (product.title.includes("Великобритан") || product.title.includes("UK")) preferredCountry = 16;
    else if (product.title.includes("Португал")) preferredCountry = 93;
    const tryCountries = [preferredCountry, ...COUNTRY_FALLBACK_CHAIN.filter(c => c !== preferredCountry)];

    console.log(`[virtual-poll] ordering number for ${order.number} (product: ${product.title})`);

    let result: { id: number; phone: string } | null = null;
    let usedCountry = preferredCountry;
    let lastError = "";
    for (const c of tryCountries) {
      try {
        result = await smsOrderNumber("tg", c);
        usedCountry = c;
        break;
      } catch (e: any) {
        lastError = String(e?.message || e);
        if (lastError.includes("NO_NUMBERS") || lastError.includes("Нет доступных номеров")) continue;
        break;
      }
    }

    if (!result) {
      console.error(`[virtual-poll] ${order.number}: all countries failed: ${lastError}`);
      // Notify admin
      const adminId = process.env.ADMIN_TG_ID?.trim();
      if (adminId && bot) {
        try {
          await bot.api.sendMessage(adminId,
            `🚨 Card-paid virtual number order failed!\n\nOrder: ${order.number}\nUser: ${order.customerTg}\nError: ${lastError.slice(0, 150)}\n\nRefund via Platega dashboard.`,
            { parse_mode: "Markdown" });
        } catch {}
      }
      // Mark order item with error
      await db.orderItem.updateMany({
        where: { orderId: order.id },
        data: { delivered: `⚠️ Не удалось заказать номер: ${lastError.slice(0, 100)}. Обратитесь в поддержку.` },
      });
      continue;
    }

    // Success — set up polling, update order item, notify buyer
    pendingSMSOrders.set(order.id, {
      activationId: result.id,
      phone: result.phone,
      attempts: 0,
      chatId: 0, // unknown — we'll send via bot.api.sendMessage to customerTg
      tgId: order.customerTg || "",
      country: usedCountry,
      gen: 0,
    });

    await db.orderItem.updateMany({
      where: { orderId: order.id },
      data: { delivered: `phone: ${result.phone}\nID: ${result.id}\n⏳ Ожидание SMS-кода...` },
    });

    // Set status to "paid" (not completed) until SMS code arrives
    await db.order.update({ where: { id: order.id }, data: { status: "paid" } });

    // Notify buyer via bot DM
    if (bot && order.customerTg) {
      try {
        const chatId = Number(order.customerTg);
        if (Number.isFinite(chatId)) {
          const kb = new InlineKeyboard()
            .text("🔄 Сменить номер", `chgnum:${order.id}`)
            .row()
            .text("❌ Отменить", `cancelnum:${order.id}`);
          await safeSendMessage(bot.api, chatId,
            `📱 *Виртуальный номер заказан!*\n\n` +
            `📞 Номер: *${result.phone}*\n` +
            `🔧 ID: ${result.id}\n\n` +
            `1. Введите этот номер в Telegram\n` +
            `2. Дождитесь SMS с кодом\n` +
            `3. Бот автоматически пришлёт код\n\n` +
            `_Если код не придёт за 10 минут — нажмите «🔄 Сменить номер»_`,
            { reply_markup: kb }
          );
        }
      } catch (e: any) {
        console.error(`[virtual-poll] notify buyer failed:`, e?.message || e);
      }
    }

    // Start polling for SMS code
    // Create a fake ctx for pollSMS (it uses ctx.api and ctx.chat)
    const fakeCtx = { api: bot?.api, chat: { id: 0 } };
    pollSMS(order.id, fakeCtx);

    console.log(`[virtual-poll] ${order.number}: ordered ${result.phone} (country=${usedCountry}), pollSMS started`);
  }
}

// Delivery for Platega-paid orders (same logic as webhook's deliverOrder).
async function deliverPlategaOrder(orderId: string) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: { items: true },
  });
  if (!order) return;

  for (const it of order.items) {
    const product = await db.product.findUnique({ where: { id: it.productId } });
    if (!product) continue;

    if (product.type === "service") {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "🚀 Заказ принят в работу. Пришлите ссылку на канал/пост в этот чат." },
      });
      continue;
    }

    const cat = await db.category.findUnique({ where: { id: product.categoryId } });
    const isVirtual = (cat?.slug === "virtual-numbers") ||
      product.slug.includes("number") || product.slug.includes("virtual") ||
      product.title.toLowerCase().includes("виртуальн") || product.title.toLowerCase().includes("номер");
    if (isVirtual) {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "📱 Номер будет заказан. Откройте чат с ботом и нажмите «📦 Мои заказы»." },
      });
      continue;
    }

    const stock = await db.stockItem.findMany({
      where: { reservedOrderId: order.id, status: "reserved" },
      take: it.qty,
    });
    if (stock.length > 0) {
      await db.stockItem.updateMany({
        where: { id: { in: stock.map((s) => s.id) } },
        data: { status: "sold", soldAt: new Date(), reservedOrderId: null },
      });
      const content = stock.map((s) => s.content).join("\n");
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: content },
      });
      await db.product.update({
        where: { id: product.id },
        data: { salesCount: { increment: stock.length } },
      });
    } else {
      await db.orderItem.update({
        where: { id: it.id },
        data: { delivered: "⚠️ Недостаточно товара. Свяжитесь с поддержкой." },
      });
    }
  }

  await db.order.update({ where: { id: orderId }, data: { status: "completed" } });

  if (order.customerId) {
    await db.customer.update({
      where: { id: order.customerId },
      data: {
        totalSpent: { increment: order.total },
        ordersCount: { increment: 1 },
      },
    });
  }
}

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
    `🎉 Заказ *${escapeMd(order.number)}* оплачен!\n\n` +
    `Спасибо за покупку 🙏\n` +
    `Вот ваш товар:\n\n` +
    lines.join("\n\n");
  
  if (codeButtons.length > 0) {
    const kb = new InlineKeyboard();
    for (const itemId of codeButtons) {
      kb.text("📱 Получить код входа", `getcode:${itemId}`).row();
    }
    kb.text("💬 Поддержка", "support");
    await safeReply(ctx, summary, { reply_markup: kb });
  } else {
    await safeReply(ctx, summary);
    await safeReply(ctx, "Если есть вопросы — нажмите 💬 Поддержка.", {
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
    await safeReply(ctx, "Заказ не найден.");
    return;
  }
  if (order.status === "completed") {
    await safeReply(ctx, "Нельзя отменить уже выполненный заказ.");
    return;
  }

  // Release reserved stock — SCOPED to this order via reservedOrderId so we never
  // release another order's reserved items.
  await db.stockItem.updateMany({
    where: { reservedOrderId: order.id },
    data: { status: "available", reservedOrderId: null },
  });

  // Capture the pre-cancel status so we can decide whether to refund Stars.
  const preCancelStatus = order.status;

  await db.order.update({
    where: { id: orderId },
    data: { status: "cancelled" },
  });

  // FIX 1: if the order was actually paid for with Telegram Stars, refund the user
  // automatically. The bot.api.refundStarPayment call needs the user's numeric tgId
  // and the persisted telegram_payment_charge_id.
  if (order.starPaymentChargeId && (preCancelStatus === "paid" || preCancelStatus === "completed")) {
    try {
      const userId = Number(order.customerTg);
      if (Number.isFinite(userId)) {
        await bot!.api.refundStarPayment(userId, order.starPaymentChargeId);
        await safeReply(ctx, `✅ Stars возвращены пользователю (charge ${order.starPaymentChargeId.slice(0, 8)}...).`);
      } else {
        await safeReply(ctx, `⚠️ У заказа нет корректного customerTg — Stars не возвращены автоматически. Верните вручную через @BotFather (charge: ${order.starPaymentChargeId}).`);
      }
    } catch (e: any) {
      console.error("[cancelOrder] refund failed:", e?.message || e);
      await safeReply(ctx, `⚠️ Не удалось вернуть Stars автоматически: ${String(e?.message || e).slice(0, 150)}\nВерните вручную через @BotFather.`);
    }
  }

  await safeReply(ctx, `Заказ ${escapeMd(order.number)} отменён. Запас возвращён на склад.`, {
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
// H9: don't fire-and-forget shutdown — catch any rejection so it gets logged.
process.on("SIGINT", () => { shutdown("SIGINT").catch((e) => console.error("[shutdown] error:", e)); });
process.on("SIGTERM", () => { shutdown("SIGTERM").catch((e) => console.error("[shutdown] error:", e)); });

// ---------- Boot ----------
(async () => {
  console.log("[tg-bot] Booting mini-service...");
  console.log(`[tg-bot] PORT=${PORT}`);
  console.log(`[tg-bot] BOT_TOKEN=${BOT_TOKEN ? "set" : "(empty)"}`);
  console.log(`[tg-bot] WEBAPP_URL=${WEBAPP_URL || "(empty)"}`);
  // H7: clean up stale stock reservations left over from a previous run.
  await releaseStaleReservations();
  console.log("[tg-bot] About to call setupBot...");
  await setupBot();
  console.log("[tg-bot] setupBot completed, botRunning:", botRunning);
  // FIX B-1: also run recovery at boot end (no-op if setupBot already triggered it
  // via onStart, but this catches the idle-mode case where BOT_TOKEN is unset so
  // setupBot never starts the bot — processPendingCardPaidVirtualNumbers poller
  // can still rescue card-paid orders via the 5-min interval).
  recoverPendingOrders().catch((e) => {
    console.error("[recovery] boot error:", e?.message || e);
  });
})();
// trigger: rebuild with sms-numbers import fix
// trigger: Dockerfile build
