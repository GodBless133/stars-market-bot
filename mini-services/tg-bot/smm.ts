// SMM модуль — интеграция с twiboost.com API
// Документация: https://twiboost.com/api/v2

const SMM_API_URL = "https://twiboost.com/api/v2";
const SMM_API_KEY = process.env.SMM_API_KEY || "";
if (!SMM_API_KEY) console.warn("[SMM] WARNING: SMM_API_KEY env var not set — SMM ordering will fail");

// Маппинг услуг: тип → service ID на twiboost
export const SMM_SERVICES: Record<string, { serviceId: string; name: string; pricePer1000: number; min: number; max: number }> = {
  // Подписчики
  "tg-subs-1000": { serviceId: "3036", name: "Накрутка подписчиков 1000", pricePer1000: 1.3, min: 1, max: 1000000 },
  "tg-subs-5000": { serviceId: "3036", name: "Накрутка подписчиков 5000", pricePer1000: 1.3, min: 1, max: 1000000 },
  "tg-subs-10000": { serviceId: "3036", name: "Накрутка подписчиков 10000", pricePer1000: 1.3, min: 1, max: 1000000 },
  // Просмотры
  "tg-views-10000": { serviceId: "1612", name: "Накрутка просмотров 10000", pricePer1000: 6.5, min: 50, max: 100000 },
  "tg-views-50000": { serviceId: "1612", name: "Накрутка просмотров 50000", pricePer1000: 6.5, min: 50, max: 100000 },
  // Реакции
  "tg-react-1000": { serviceId: "2817", name: "Накрутка реакций 1000", pricePer1000: 1.2, min: 1, max: 150000 },
  // Premium подписчики
  "tg-premium-subs-1000": { serviceId: "1292", name: "Накрутка Premium подписчиков 1000", pricePer1000: 7.6, min: 1, max: 100000 },
  "tg-premium-subs-5000": { serviceId: "1292", name: "Накрутка Premium подписчиков 5000", pricePer1000: 7.6, min: 1, max: 100000 },
  // Просмотры 100 постов
  "tg-views-100posts": { serviceId: "1699", name: "Накрутка просмотров 100 постов", pricePer1000: 2.6, min: 100, max: 100000000 },
  // Реакции на пост 5000
  "tg-react-post-5000": { serviceId: "3303", name: "Накрутка реакций на пост 5000", pricePer1000: 1.2, min: 1, max: 150000 },
};

/**
 * Проверить баланс SMM-сервиса
 */
export async function getBalance(): Promise<{ balance: number; currency: string } | { error: string }> {
  if (!SMM_API_KEY) return { error: "SMM_API_KEY not configured" };
  try {
    const url = `${SMM_API_URL}?key=${SMM_API_KEY}&action=balance`;
    // Do NOT log the URL — it contains the API key.
    console.log("[SMM] getBalance request (key redacted)");
    // FIX 4: 15s timeout — if twiboost hangs, don't hang the bot.
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    console.log("[SMM] getBalance response:", JSON.stringify(data));
    if (data.error) return { error: data.error };
    const bal = parseFloat(data.balance);
    if (!Number.isFinite(bal)) return { error: "Invalid balance response" };
    return { balance: bal, currency: data.currency };
  } catch (e: any) {
    console.error("[SMM] getBalance error:", e?.message || e);
    // FIX 4: surface a friendlier message on timeout/abort.
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { error: "Таймаут — сервис не ответил за 15 сек" };
    }
    return { error: e?.message || String(e) };
  }
}

/**
 * Создать заказ на накрутку
 */
export async function createOrder(
  serviceId: string,
  link: string,
  quantity: number
): Promise<{ orderId: number } | { error: string }> {
  if (!SMM_API_KEY) return { error: "SMM_API_KEY not configured" };
  try {
    // Используем GET с query параметрами (как balance — это работает)
    const url = `${SMM_API_URL}?key=${SMM_API_KEY}&action=add&service=${serviceId}&link=${encodeURIComponent(link)}&quantity=${quantity}`;
    // Do NOT log the URL — it contains the API key.
    console.log("[SMM] createOrder request (key redacted)", { serviceId, quantity });

    // FIX 4: 15s timeout — if twiboost hangs, don't hang the bot.
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    console.log("[SMM] createOrder raw response:", text);

    const data = JSON.parse(text);
    if (data.error) {
      console.error("[SMM] createOrder API error:", data.error);
      return { error: data.error };
    }
    if (!data.order) {
      console.error("[SMM] createOrder no order in response:", text);
      return { error: "Не получен номер заказа: " + text };
    }
    console.log("[SMM] createOrder success! Order ID:", data.order);
    return { orderId: data.order };
  } catch (e: any) {
    console.error("[SMM] createOrder exception:", e?.message || e);
    // FIX 4: surface a friendlier message on timeout/abort.
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { error: "Таймаут — сервис не ответил за 15 сек" };
    }
    return { error: e?.message || String(e) };
  }
}

/**
 * Проверить статус заказа
 */
export async function getOrderStatus(
  orderId: number
): Promise<{
  status: string;
  startCount?: number;
  remains?: number;
  charge?: number;
} | { error: string }> {
  try {
    const url = `${SMM_API_URL}?key=${SMM_API_KEY}&action=status&order=${orderId}`;
    // FIX 4: 15s timeout — if twiboost hangs, don't hang the bot (esp. the 5-min poll loop).
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await res.json();
    if (data.error) return { error: data.error };
    const startCount = data.start_count ? parseInt(data.start_count) : undefined;
    const remains = data.remains ? parseInt(data.remains) : undefined;
    const charge = data.charge ? parseFloat(data.charge) : undefined;
    return {
      status: data.status,
      startCount: startCount !== undefined && Number.isFinite(startCount) ? startCount : undefined,
      remains: remains !== undefined && Number.isFinite(remains) ? remains : undefined,
      charge: charge !== undefined && Number.isFinite(charge) ? charge : undefined,
    };
  } catch (e: any) {
    // FIX 4: surface a friendlier message on timeout/abort.
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      return { error: "Таймаут — сервис не ответил за 15 сек" };
    }
    return { error: e?.message || String(e) };
  }
}

/**
 * Рассчитать стоимость накрутки для покупателя (с наценкой 300%)
 */
export function calculatePrice(serviceKey: string): number {
  const service = SMM_SERVICES[serviceKey];
  if (!service) return 0;
  const qty = parseInt(serviceKey.split("-").pop() || "0");
  const cost = (qty / 1000) * service.pricePer1000;
  const price = cost * 4;
  return Math.max(1, Math.round(price));
}
