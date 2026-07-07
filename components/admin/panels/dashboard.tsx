"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatPrice, formatNumber, formatDate } from "@/lib/store"
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts"
import {
  Package,
  ShoppingCart,
  Users,
  Star,
  TrendingUp,
  AlertTriangle,
  DollarSign,
} from "lucide-react"

interface Stats {
  totals: {
    products: number
    orders: number
    customers: number
    reviews: number
    pendingOrders: number
    completedOrders: number
    revenue: number
  }
  revenueChart: { date: string; revenue: number; orders: number }[]
  topProducts: { id: string; title: string; salesCount: number; price: number }[]
  categories: { id: string; name: string; slug: string; icon: string; _count: { products: number } }[]
  lowStock: { id: string; title: string; inStock: number }[]
}

export function AdminDashboard() {
  const [data, setData] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .get<Stats>("/api/admin/stats")
      .then((d) => setData(d))
      .finally(() => setLoading(false))
  }, [])

  if (loading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />
        ))}
      </div>
    )
  }

  const cards = [
    {
      label: "Выручка",
      value: formatPrice(data.totals.revenue),
      icon: DollarSign,
      color: "from-emerald-400 to-green-600",
    },
    {
      label: "Заказов",
      value: formatNumber(data.totals.orders),
      sub: `${data.totals.pendingOrders} ожидают`,
      icon: ShoppingCart,
      color: "from-sky-400 to-cyan-600",
    },
    {
      label: "Товаров",
      value: formatNumber(data.totals.products),
      icon: Package,
      color: "from-amber-400 to-orange-600",
    },
    {
      label: "Клиентов",
      value: formatNumber(data.totals.customers),
      sub: `${data.totals.reviews} отзывов`,
      icon: Users,
      color: "from-pink-400 to-rose-600",
    },
  ]

  const chartData = data.revenueChart.map((d) => ({
    ...d,
    label: new Date(d.date).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Дашборд</h1>
        <p className="text-sm text-muted-foreground">
          Обзор магазина в реальном времени
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="relative overflow-hidden">
            <div
              className={`absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br ${c.color} opacity-20`}
            />
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{c.label}</p>
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br ${c.color} text-white`}
                >
                  <c.icon className="h-4 w-4" />
                </div>
              </div>
              <p className="mt-2 text-2xl font-bold">{c.value}</p>
              {c.sub && <p className="text-xs text-muted-foreground mt-1">{c.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4 text-emerald-500" />
              Выручка за 14 дней
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" width={50} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid #e5e7eb",
                    fontSize: 12,
                  }}
                  formatter={(v: any) => [formatPrice(Number(v)), "Выручка"]}
                />
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#rev)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Star className="h-4 w-4 text-amber-500" />
              Топ товаров
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.topProducts.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs font-bold">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {p.salesCount} продаж
                  </p>
                </div>
                <span className="text-sm font-semibold">{formatPrice(p.price)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Заказы по дням</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 12 }} stroke="#9ca3af" width={30} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e5e7eb", fontSize: 12 }}
                />
                <Bar dataKey="orders" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Заканчивается
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[220px] overflow-y-auto">
            {data.lowStock.length === 0 && (
              <p className="text-sm text-muted-foreground">Все товары в наличии</p>
            )}
            {data.lowStock.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 rounded-lg border p-2">
                <span className="truncate text-sm">{p.title}</span>
                <Badge variant="destructive">{p.inStock} шт.</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Категории</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.categories.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border p-3 flex items-center gap-3"
              >
                <span className="text-2xl">{c.icon}</span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {c._count.products} товаров
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
