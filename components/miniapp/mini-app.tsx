"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { useStore } from "@/lib/store-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ProductCover } from "@/components/product-cover"
import { Stars } from "@/components/stars"
import { formatPrice, PRODUCT_TYPES, timeAgo } from "@/lib/store"
import {
  ArrowLeft,
  ShoppingCart,
  Search,
  Zap,
  Check,
  Plus,
  Minus,
  Trash2,
  Star,
  Home,
  Clock,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

// Minimal Telegram WebApp typing (single declaration — app/page.tsx relies on this)
declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        ready: () => void
        expand: () => void
        platform?: string
        themeParams?: any
        colorScheme?: "light" | "dark" | string
        // FIX 1: initData is the HMAC-signed payload the server validates.
        initData?: string
        initDataUnsafe?: any
        MainButton?: any
        BackButton?: any
        HapticFeedback?: {
          impactOccurred: (s: string) => void
          notificationOccurred: (s: string) => void
        }
        setHeaderColor?: (c: string) => void
        setBackgroundColor?: (c: string) => void
        openInvoice?: (
          url: string,
          cb?: (status: "paid" | "cancelled" | "failed" | "pending") => void
        ) => void
      }
    }
  }
}

type View = "home" | "categories" | "catalog" | "product" | "cart" | "checkout" | "orders" | "success"

interface Category {
  id: string
  name: string
  slug: string
  icon: string
  description?: string | null
  _count?: { products: number }
}

interface Product {
  id: string
  title: string
  description: string
  price: number
  oldPrice: number | null
  image: string | null
  type: string
  badge: string | null
  rating: number
  salesCount: number
  inStock: number
  category?: { name: string; icon: string }
}

interface Order {
  id: string
  number: string
  status: string
  total: number
  createdAt: string
  items: { id: string; title: string; price: number; qty: number; delivered: string | null }[]
}

export function MiniApp({ onExit }: { onExit: () => void }) {
  const [view, setView] = useState<View>("home")
  const [products, setProducts] = useState<Product[]>([])
  const [featured, setFeatured] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [activeCategory, setActiveCategory] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [search, setSearch] = useState("")
  const [orders, setOrders] = useState<Order[]>([])
  const [orderResult, setOrderResult] = useState<{ number: string; delivered: string | null } | null>(null)
  const [paying, setPaying] = useState(false)

  const items = useStore((s) => s.items)
  const add = useStore((s) => s.add)
  const remove = useStore((s) => s.remove)
  const setQty = useStore((s) => s.setQty)
  const clear = useStore((s) => s.clear)
  const total = useStore((s) => s.total())
  const count = useStore((s) => s.count())
  const tgUser = useStore((s) => s.tgUser)
  const setTgUser = useStore((s) => s.setTgUser)

  // Init Telegram WebApp
  useEffect(() => {
    const tg = window.Telegram?.WebApp
    if (tg) {
      tg.ready()
      tg.expand()
      // FIX 1: initDataUnsafe is CLIENT-CONTROLLED and used here ONLY for
      // cosmetic display (name/avatar). Authentication is handled server-side
      // via the HMAC-signed initData header attached by lib/api-client.ts —
      // the server ignores this tgUser.id for any auth decision.
      const u = tg.initDataUnsafe?.user
      if (u) {
        setTgUser({ id: String(u.id), firstName: u.first_name, username: u.username })
      }
      try {
        tg.setHeaderColor?.("#0a0a0a")
        tg.setBackgroundColor?.("#0a0a0a")
      } catch {}
    }
  }, [setTgUser])

  // Load categories once
  useEffect(() => {
    api.get<{ categories: Category[] }>("/api/categories").then((d) => {
      setCategories(d.categories)
    })
  }, [])

  // Load products (filtered by activeCategory)
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (activeCategory !== "all") params.set("category", activeCategory)
    Promise.all([
      api.get<{ products: Product[] }>(`/api/products?${params}`),
      api.get<{ products: Product[] }>("/api/products?featured=1"),
    ])
      .then(([a, b]) => {
        setProducts(a.products)
        setFeatured(b.products)
      })
      .finally(() => setLoading(false))
  }, [activeCategory])

  // Load orders when viewing
  useEffect(() => {
    if (view === "orders" && tgUser?.id) {
      api.get<{ orders: Order[] }>(`/api/orders?tgId=${tgUser.id}`).then((d) => setOrders(d.orders))
    }
  }, [view, tgUser])

  const filtered = search
    ? products.filter(
        (p) =>
          p.title.toLowerCase().includes(search.toLowerCase()) ||
          p.description.toLowerCase().includes(search.toLowerCase())
      )
    : products

  const haptic = (type: "light" | "success" | "error" = "light") => {
    const tg = window.Telegram?.WebApp
    if (!tg?.HapticFeedback) return
    if (type === "success") tg.HapticFeedback.notificationOccurred("success")
    else if (type === "error") tg.HapticFeedback.notificationOccurred("error")
    else tg.HapticFeedback.impactOccurred("light")
  }

  const addToCart = (p: Product) => {
    add({ productId: p.id, title: p.title, price: p.price, image: p.image || undefined })
    haptic("success")
    toast.success("Добавлено в корзину")
  }

  // Pay with Telegram Stars via /api/stars-invoice + Telegram.WebApp.openInvoice
  const payWithStars = async (orderItems: { productId: string; qty: number }[]) => {
    if (orderItems.length === 0) return
    setPaying(true)
    try {
      const res = await api.post<{
        orderId: string
        orderNumber: string
        totalRub: number
        totalStars: number
        invoiceLink: string
        slug: string | null
      }>("/api/stars-invoice", {
        items: orderItems,
        customerName: tgUser?.firstName,
        customerTg: tgUser?.id,
      })

      const tg = window.Telegram?.WebApp
      if (!tg?.openInvoice) {
        // Fallback (not in Telegram): show invoice link + instruction
        toast("Откройте через Telegram-бота для оплаты звёздами", {
          description: "Или оплатите по ссылке в боте",
        })
        window.open(res.invoiceLink, "_blank")
        setPaying(false)
        return
      }

      haptic("light")
      tg.openInvoice(res.invoiceLink, async (status) => {
        if (status === "paid") {
          haptic("success")
          // Bot already delivered via successful_payment; fetch the order to show result
          try {
            const { order } = await api.get<{ order: Order }>(`/api/orders?number=${res.orderNumber}`)
            const delivered = order.items
              ?.map((it) => it.delivered)
              .filter(Boolean)
              .join("\n\n---\n\n")
            setOrderResult({ number: order.number, delivered })
            clear()
            setView("success")
          } catch {
            setOrderResult({ number: res.orderNumber, delivered: "✅ Оплата получена. Товар выдан в чате с ботом." })
            clear()
            setView("success")
          }
        } else if (status === "cancelled") {
          haptic("error")
          toast.error("Оплата отменена")
        } else {
          haptic("error")
          toast.error(`Статус оплаты: ${status}`)
        }
        setPaying(false)
      })
    } catch (e: any) {
      haptic("error")
      toast.error(e.message)
      setPaying(false)
    }
  }

  const checkout = () => payWithStars(items.map((i) => ({ productId: i.productId, qty: i.qty })))

  // Buy now (single product) via Stars
  const buyNow = (p: Product) => payWithStars([{ productId: p.id, qty: 1 }])

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col max-w-md mx-auto" style={{ background: "var(--tg-bg, #0a0a0a)" }}>
      {/* Header */}
      <header className="sticky top-0 z-30 bg-zinc-950/90 backdrop-blur border-b border-white/5">
        <div className="flex items-center gap-2 px-4 h-14">
          {view !== "home" && (
            <button
              onClick={() => {
                if (view === "product") setView(activeCategory === "all" ? "catalog" : "categories")
                else if (view === "catalog") setView("categories")
                else if (view === "success") setView("home")
                else setView("home")
              }}
              className="p-1.5 -ml-1.5 rounded-lg hover:bg-white/5"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex items-center gap-2 flex-1">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600">
              <Zap className="h-4 w-4" />
            </div>
            <span className="font-bold">Stars Market</span>
          </div>
          {view === "home" && (
            <button onClick={onExit} className="text-xs text-zinc-400 hover:text-white px-2 py-1 rounded">
              Выйти
            </button>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-y-auto pb-24">
        {view === "home" && (
          <div className="p-4 space-y-6">
            {/* Hero */}
            <div className="rounded-3xl bg-gradient-to-br from-amber-500/20 via-orange-600/10 to-transparent border border-amber-500/20 p-5 relative overflow-hidden">
              <div className="absolute -top-8 -right-8 h-32 w-32 rounded-full bg-amber-500/20 blur-2xl" />
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 mb-2">
                ⭐ Stars · Premium · Аккаунты
              </Badge>
              <h1 className="text-2xl font-bold leading-tight">
                Покупай мгновенно
                <br />
                прямо в Telegram
              </h1>
              <p className="text-sm text-zinc-400 mt-2">
                Автовыдача 24/7. Лучшие цены на звёзды и аккаунты.
              </p>
            </div>

            {/* Quick actions */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { icon: "🛍", label: "Каталог", v: "categories" as View },
                { icon: "⭐", label: "Звёзды", v: "catalog" as View, cat: "telegram-stars" },
                { icon: "🚀", label: "Накрутка", v: "catalog" as View, cat: "boost" },
                { icon: "🛒", label: "Корзина", v: "cart" as View },
              ].map((a) => (
                <button
                  key={a.label}
                  onClick={() => {
                    if (a.cat) setActiveCategory(a.cat)
                    setView(a.v)
                  }}
                  className="flex flex-col items-center gap-1 rounded-2xl bg-white/5 border border-white/5 p-3 hover:bg-white/10 transition"
                >
                  <span className="text-2xl">{a.icon}</span>
                  <span className="text-xs">{a.label}</span>
                </button>
              ))}
            </div>

            {/* Reviews banner */}
            <a
              href="/reviews"
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-2xl bg-gradient-to-br from-amber-500/20 via-orange-600/10 to-transparent border border-amber-500/20 p-4 relative overflow-hidden"
            >
              <div className="absolute -top-4 -right-4 h-20 w-20 rounded-full bg-amber-500/20 blur-2xl" />
              <div className="relative flex items-center gap-3">
                <span className="text-3xl">⭐</span>
                <div className="flex-1">
                  <p className="font-bold text-sm">Отзывы покупателей</p>
                  <p className="text-xs text-zinc-400 mt-0.5">Читайте реальные отзывы и оставьте свой</p>
                </div>
                <span className="text-amber-400 text-lg">→</span>
              </div>
            </a>

            {/* Categories grid */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold">📂 Категории</h2>
                <button onClick={() => setView("categories")} className="text-xs text-amber-400">
                  Все →
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {categories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      setActiveCategory(c.slug)
                      setView("catalog")
                    }}
                    className="flex items-center gap-2 rounded-2xl bg-white/5 border border-white/5 p-3 text-left hover:border-amber-500/30 transition"
                  >
                    <span className="text-2xl">{c.icon}</span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{c.name}</p>
                      <p className="text-[10px] text-zinc-500">{c._count?.products ?? 0} тов.</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Featured */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold">🔥 Хиты продаж</h2>
                <button onClick={() => setView("catalog")} className="text-xs text-amber-400">
                  Все →
                </button>
              </div>
              {loading ? (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-44 w-36 rounded-2xl bg-white/5" />
                  ))}
                </div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4">
                  {featured.slice(0, 6).map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setSelectedProduct(p)
                        setView("product")
                      }}
                      className="flex-shrink-0 w-36 rounded-2xl bg-white/5 border border-white/5 overflow-hidden text-left hover:border-amber-500/30 transition"
                    >
                      <ProductCover image={p.image || undefined} title={p.title} className="h-24 w-full" />
                      <div className="p-2.5">
                        <p className="text-xs font-medium line-clamp-2 min-h-[2rem]">{p.title}</p>
                        <p className="text-sm font-bold text-amber-400 mt-1">{formatPrice(p.price)}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Trust */}
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/5 p-3">
                <Clock className="h-4 w-4 mx-auto text-sky-400" />
                <p className="text-[10px] mt-1 text-zinc-400">Мгновенно</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <ShieldCheck className="h-4 w-4 mx-auto text-emerald-400" />
                <p className="text-[10px] mt-1 text-zinc-400">Гарантия</p>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <Star className="h-4 w-4 mx-auto text-amber-400" />
                <p className="text-[10px] mt-1 text-zinc-400">4.9 рейтинг</p>
              </div>
            </div>
          </div>
        )}

        {view === "categories" && (
          <div className="p-4 space-y-3">
            <h2 className="font-bold text-lg">Все категории</h2>
            <div className="space-y-2">
              {/* All products */}
              <button
                onClick={() => {
                  setActiveCategory("all")
                  setView("catalog")
                }}
                className={cn(
                  "w-full flex items-center gap-3 rounded-2xl border p-4 text-left transition",
                  activeCategory === "all"
                    ? "bg-amber-500/15 border-amber-500/40"
                    : "bg-white/5 border-white/5 hover:border-amber-500/30"
                )}
              >
                <span className="text-3xl">🛍</span>
                <div className="flex-1">
                  <p className="font-semibold">Все товары</p>
                  <p className="text-xs text-zinc-400">Весь каталог</p>
                </div>
                <span className="text-amber-400">→</span>
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setActiveCategory(c.slug)
                    setView("catalog")
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 rounded-2xl border p-4 text-left transition",
                    activeCategory === c.slug
                      ? "bg-amber-500/15 border-amber-500/40"
                      : "bg-white/5 border-white/5 hover:border-amber-500/30"
                  )}
                >
                  <span className="text-3xl">{c.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{c.name}</p>
                    <p className="text-xs text-zinc-400 line-clamp-1">{c.description || `${c._count?.products ?? 0} товаров`}</p>
                  </div>
                  <span className="text-amber-400">→</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {view === "catalog" && (
          <div className="p-4 space-y-3">
            {/* Category chips */}
            <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4">
              <button
                onClick={() => setActiveCategory("all")}
                className={cn(
                  "flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap",
                  activeCategory === "all"
                    ? "bg-amber-500 text-black"
                    : "bg-white/5 text-zinc-300"
                )}
              >
                Все
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(c.slug)}
                  className={cn(
                    "flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap",
                    activeCategory === c.slug
                      ? "bg-amber-500 text-black"
                      : "bg-white/5 text-zinc-300"
                  )}
                >
                  {c.icon} {c.name}
                </button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
              <input
                placeholder="Поиск..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl bg-white/5 border border-white/10 pl-9 pr-4 py-2.5 text-sm outline-none focus:border-amber-500/50"
              />
            </div>
            {loading ? (
              <div className="grid grid-cols-2 gap-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-52 rounded-2xl bg-white/5" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filtered.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-2xl bg-white/5 border border-white/5 overflow-hidden"
                  >
                    <button
                      onClick={() => {
                        setSelectedProduct(p)
                        setView("product")
                      }}
                      className="block w-full text-left"
                    >
                      <ProductCover image={p.image || undefined} title={p.title} className="aspect-[5/3] w-full" />
                    </button>
                    <div className="p-2.5">
                      <p className="text-xs font-medium line-clamp-2 min-h-[2rem]">{p.title}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span className="font-bold text-amber-400">
                          {formatPrice(p.price)}
                          <span className="text-[10px] text-zinc-500 ml-1">
                            · {Math.max(1, Math.round(p.price / 1.4))}⭐
                          </span>
                        </span>
                        <button
                          onClick={() => addToCart(p)}
                          disabled={p.inStock === 0 && p.type !== "service"}
                          className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-amber-500 to-orange-600 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view === "product" && selectedProduct && (
          <div className="pb-32">
            <ProductCover image={selectedProduct.image || undefined} title={selectedProduct.title} className="aspect-[4/3] w-full" />
            <div className="p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2 text-xs text-zinc-400 mb-1">
                  <span>{PRODUCT_TYPES[selectedProduct.type]?.icon}</span>
                  <span>{selectedProduct.category?.name}</span>
                </div>
                <h1 className="text-xl font-bold">{selectedProduct.title}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <Stars value={selectedProduct.rating} size={14} />
                  <span className="text-xs text-zinc-400">· {selectedProduct.salesCount} продаж</span>
                </div>
              </div>
              <p className="text-sm text-zinc-300">{selectedProduct.description}</p>
              <div className="flex items-end gap-2">
                <span className="text-3xl font-bold text-amber-400">{formatPrice(selectedProduct.price)}</span>
                {selectedProduct.oldPrice && (
                  <span className="text-sm text-zinc-500 line-through mb-1">
                    {formatPrice(selectedProduct.oldPrice)}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-white/5 p-2.5">
                  <ShieldCheck className="h-4 w-4 mx-auto text-emerald-400" />
                  <p className="mt-1 text-zinc-400">Гарантия</p>
                </div>
                <div className="rounded-xl bg-white/5 p-2.5">
                  <Clock className="h-4 w-4 mx-auto text-sky-400" />
                  <p className="mt-1 text-zinc-400">Мгновенно</p>
                </div>
                <div className="rounded-xl bg-white/5 p-2.5">
                  <Zap className="h-4 w-4 mx-auto text-amber-400" />
                  <p className="mt-1 text-zinc-400">24/7</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {view === "cart" && (
          <div className="p-4 space-y-3 pb-32">
            <h2 className="font-bold text-lg">Корзина</h2>
            {items.length === 0 ? (
              <div className="text-center py-16 text-zinc-500">
                <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Корзина пуста</p>
                <Button variant="outline" className="mt-3 border-white/10" onClick={() => setView("catalog")}>
                  В каталог
                </Button>
              </div>
            ) : (
              <>
                {items.map((item) => (
                  <div key={item.productId} className="flex gap-3 rounded-2xl bg-white/5 border border-white/5 p-2.5">
                    <ProductCover image={item.image} title={item.title} className="h-14 w-14 rounded-lg flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium line-clamp-2">{item.title}</p>
                      <p className="text-sm font-bold text-amber-400">{formatPrice(item.price)}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <button onClick={() => setQty(item.productId, item.qty - 1)} className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10">
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-6 text-center text-sm">{item.qty}</span>
                          <button onClick={() => setQty(item.productId, item.qty + 1)} className="flex h-6 w-6 items-center justify-center rounded-md bg-white/10">
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <button onClick={() => remove(item.productId)} className="text-zinc-500 hover:text-red-400 p-1">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {view === "orders" && (
          <div className="p-4 space-y-3">
            <h2 className="font-bold text-lg">Мои заказы</h2>
            {!tgUser?.id && (
              <p className="text-sm text-zinc-500 text-center py-8">
                Откройте Mini App из Telegram-бота, чтобы видеть заказы
              </p>
            )}
            {tgUser?.id && orders.length === 0 && (
              <p className="text-sm text-zinc-500 text-center py-8">Заказов пока нет</p>
            )}
            {orders.map((o) => (
              <div key={o.id} className="rounded-2xl bg-white/5 border border-white/5 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-zinc-400">{o.number}</span>
                  <Badge variant="outline" className="border-amber-500/30 text-amber-400">
                    {o.status}
                  </Badge>
                </div>
                <div className="mt-2 space-y-1">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex justify-between text-sm">
                      <span className="text-zinc-300 truncate pr-2">{it.title} × {it.qty}</span>
                      <span className="text-zinc-400">{formatPrice(it.price * it.qty)}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t border-white/5 flex justify-between">
                  <span className="text-xs text-zinc-500">{timeAgo(o.createdAt)}</span>
                  <span className="font-bold text-amber-400">{formatPrice(o.total)}</span>
                </div>
                {o.items.some((it) => it.delivered) && (
                  <pre className="mt-2 text-[10px] bg-black/30 rounded p-2 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">
                    {o.items.map((it) => it.delivered).filter(Boolean).join("\n")}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}

        {view === "success" && orderResult && (
          <div className="p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/20">
              <Check className="h-8 w-8 text-emerald-400" />
            </div>
            <h2 className="text-xl font-bold">Заказ выполнен!</h2>
            <p className="text-sm text-zinc-400 mt-1">
              № <span className="font-mono">{orderResult.number}</span>
            </p>
            {orderResult.delivered && (
              <div className="mt-4 text-left">
                <p className="text-sm font-medium text-emerald-400 mb-2">🎉 Ваши товары:</p>
                <pre className="text-xs bg-black/30 rounded-lg p-3 whitespace-pre-wrap break-all max-h-64 overflow-y-auto border border-white/5">
                  {orderResult.delivered}
                </pre>
              </div>
            )}
            <Button
              className="w-full mt-6 bg-gradient-to-br from-amber-500 to-orange-600 rounded-full"
              onClick={() => {
                setOrderResult(null)
                setView("home")
              }}
            >
              Готово
            </Button>
          </div>
        )}
      </main>

      {/* Bottom bar */}
      {(view === "home" || view === "catalog" || view === "product") && (
        <nav className="sticky bottom-0 bg-zinc-950/90 backdrop-blur border-t border-white/5 flex">
          <button
            onClick={() => setView("home")}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2.5", view === "home" ? "text-amber-400" : "text-zinc-500")}
          >
            <Home className="h-5 w-5" />
            <span className="text-[10px]">Главная</span>
          </button>
          <button
            onClick={() => setView("catalog")}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2.5", view === "catalog" ? "text-amber-400" : "text-zinc-500")}
          >
            <Search className="h-5 w-5" />
            <span className="text-[10px]">Каталог</span>
          </button>
          <button
            onClick={() => setView("orders")}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2.5", view === "orders" ? "text-amber-400" : "text-zinc-500")}
          >
            <Clock className="h-5 w-5" />
            <span className="text-[10px]">Заказы</span>
          </button>
          <button
            onClick={() => setView("cart")}
            className={cn("flex-1 flex flex-col items-center gap-0.5 py-2.5 relative", view === "cart" ? "text-amber-400" : "text-zinc-500")}
          >
            <ShoppingCart className="h-5 w-5" />
            {count > 0 && (
              <span className="absolute top-1.5 right-1/4 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 text-[9px] font-bold px-1">
                {count}
              </span>
            )}
            <span className="text-[10px]">Корзина</span>
          </button>
        </nav>
      )}

      {/* Checkout button (cart view) */}
      {view === "cart" && items.length > 0 && (
        <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur border-t border-white/5 p-3">
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-sm text-zinc-400">Итого</span>
            <span className="text-lg font-bold text-amber-400">
              {formatPrice(total)} · {Math.max(1, Math.round(total / 1.4))} ⭐
            </span>
          </div>
          <Button
            className="w-full bg-gradient-to-br from-amber-500 to-orange-600 rounded-full"
            onClick={checkout}
            disabled={paying}
          >
            {paying ? "Создание счёта..." : `⭐ Оплатить звёздами`}
          </Button>
        </div>
      )}

      {/* Add to cart button (product view) */}
      {view === "product" && selectedProduct && (
        <div className="sticky bottom-0 bg-zinc-950/95 backdrop-blur border-t border-white/5 p-3 flex gap-2">
          <Button
            variant="outline"
            className="border-white/10 flex-1 rounded-full"
            onClick={() => addToCart(selectedProduct)}
            disabled={selectedProduct.inStock === 0 && selectedProduct.type !== "service"}
          >
            <Plus className="h-4 w-4 mr-1" /> В корзину
          </Button>
          <Button
            className="flex-[2] bg-gradient-to-br from-amber-500 to-orange-600 rounded-full"
            onClick={() => buyNow(selectedProduct)}
            disabled={paying || (selectedProduct.inStock === 0 && selectedProduct.type !== "service")}
          >
            {paying ? "..." : `⭐ Купить за ${Math.max(1, Math.round(selectedProduct.price / 1.4))} ⭐`}
          </Button>
        </div>
      )}
    </div>
  )
}
