// Currency formatting + shared store constants
export const CURRENCIES: Record<string, { symbol: string; label: string }> = {
  RUB: { symbol: "₽", label: "Рубль" },
  USD: { symbol: "$", label: "Доллар" },
  EUR: { symbol: "€", label: "Евро" },
  UAH: { symbol: "₴", label: "Гривна" },
}

export function formatPrice(value: number, currency = "RUB") {
  const c = CURRENCIES[currency] ?? CURRENCIES.RUB
  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value)
  return `${formatted} ${c.symbol}`
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value)
}

export function formatDate(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function timeAgo(d: Date | string) {
  const date = typeof d === "string" ? new Date(d) : d
  const diff = Date.now() - date.getTime()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return "только что"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day} дн назад`
  return formatDate(date)
}

export const ORDER_STATUS: Record<string, { label: string; color: string }> = {
  pending: { label: "Ожидает оплаты", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" },
  paid: { label: "Оплачен", color: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  completed: { label: "Выполнен", color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  cancelled: { label: "Отменён", color: "bg-zinc-500/15 text-zinc-500 border-zinc-500/30" },
  refunded: { label: "Возврат", color: "bg-rose-500/15 text-rose-600 border-rose-500/30" },
}

export const PRODUCT_TYPES: Record<string, { label: string; icon: string }> = {
  digital: { label: "Цифровой товар", icon: "📦" },
  stars: { label: "Telegram Stars", icon: "⭐" },
  account: { label: "Аккаунт", icon: "👤" },
  service: { label: "Услуга", icon: "🛠️" },
}

export function genOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase().slice(-6)
  const rand = Math.random().toString(36).toUpperCase().slice(2, 6)
  return `ORD-${ts}${rand}`
}
