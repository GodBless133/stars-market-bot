// Shared helpers for the tg-bot mini-service.

export const CURRENCIES: Record<string, { symbol: string; label: string }> = {
  RUB: { symbol: "₽", label: "Рубль" },
  USD: { symbol: "$", label: "Доллар" },
  EUR: { symbol: "€", label: "Евро" },
  UAH: { symbol: "₴", label: "Гривна" },
};

export function formatPrice(value: number, currency = "RUB"): string {
  const c = CURRENCIES[currency] ?? CURRENCIES.RUB;
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
  return `${formatted} ${c.symbol}`;
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export const ORDER_STATUS: Record<string, string> = {
  pending: "⏳ Ожидает оплаты",
  paid: "🟦 Оплачен",
  completed: "✅ Выполнен",
  cancelled: "❌ Отменён",
  refunded: "↩️ Возврат",
};

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS[status] ?? status;
}

export function genOrderNumber(): string {
  const ts = Date.now().toString(36).toUpperCase().slice(-6);
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6);
  return `ORD-${ts}${rand}`;
}
