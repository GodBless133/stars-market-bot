"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { formatPrice, formatDate, ORDER_STATUS } from "@/lib/store"
import {
  Search,
  ShoppingCart,
  Eye,
  CheckCircle,
  XCircle,
  RefreshCw,
} from "lucide-react"

interface OrderItem {
  id: string
  title: string
  price: number
  qty: number
  delivered: string | null
}

interface Order {
  id: string
  number: string
  status: string
  total: number
  payMethod: string | null
  customerName: string | null
  customerTg: string | null
  note: string | null
  createdAt: string
  items: OrderItem[]
}

const STATUS_FILTERS = ["all", "pending", "paid", "completed", "cancelled", "refunded"]

export function AdminOrders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus] = useState("all")
  const [search, setSearch] = useState("")
  const [viewing, setViewing] = useState<Order | null>(null)

  const load = () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (status !== "all") params.set("status", status)
    api
      .get<{ orders: Order[] }>(`/api/admin/orders?${params}`)
      .then((d) => {
        let list = d.orders
        if (search) {
          const q = search.toLowerCase()
          list = list.filter(
            (o) =>
              o.number.toLowerCase().includes(q) ||
              o.customerName?.toLowerCase().includes(q) ||
              o.customerTg?.includes(q)
          )
        }
        setOrders(list)
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  useEffect(() => {
    const t = setTimeout(load, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const action = async (order: Order, act: "pay" | "cancel" | "refund") => {
    try {
      await api.patch(`/api/admin/orders/${order.id}`, { action: act })
      toast.success(
        act === "pay"
          ? "Заказ выполнен, товар выдан"
          : act === "cancel"
          ? "Заказ отменён"
          : "Возврат оформлен"
      )
      setViewing(null)
      load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Заказы</h1>
        <p className="text-sm text-muted-foreground">
          Управление заказами и выдачей товаров
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по номеру, имени, Telegram ID..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-1 overflow-x-auto">
          {STATUS_FILTERS.map((s) => (
            <Button
              key={s}
              variant={status === s ? "default" : "outline"}
              size="sm"
              onClick={() => setStatus(s)}
              className="whitespace-nowrap"
            >
              {s === "all" ? "Все" : ORDER_STATUS[s]?.label || s}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Заказов нет
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-zinc-50 dark:bg-zinc-900 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Номер</th>
                  <th className="px-4 py-3 font-medium">Клиент</th>
                  <th className="px-4 py-3 font-medium">Сумма</th>
                  <th className="px-4 py-3 font-medium">Оплата</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Дата</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const st = ORDER_STATUS[o.status] || {
                    label: o.status,
                    color: "",
                  }
                  return (
                    <tr
                      key={o.id}
                      className="border-t hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
                    >
                      <td className="px-4 py-3 font-mono text-xs">{o.number}</td>
                      <td className="px-4 py-3">
                        <div className="font-medium">
                          {o.customerName || "—"}
                        </div>
                        {o.customerTg && (
                          <div className="text-xs text-muted-foreground">
                            TG: {o.customerTg}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 font-semibold">
                        {formatPrice(o.total)}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {o.payMethod || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={st.color} variant="outline">
                          {st.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDate(o.createdAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setViewing(o)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewing && (
        <Dialog open onOpenChange={() => setViewing(null)}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="font-mono">{viewing.number}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted-foreground">Статус</p>
                  <Badge
                    className={ORDER_STATUS[viewing.status]?.color}
                    variant="outline"
                  >
                    {ORDER_STATUS[viewing.status]?.label}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Сумма</p>
                  <p className="font-semibold">{formatPrice(viewing.total)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Клиент</p>
                  <p className="font-medium">{viewing.customerName || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telegram</p>
                  <p className="font-medium">{viewing.customerTg || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Оплата</p>
                  <p className="font-medium">{viewing.payMethod || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Дата</p>
                  <p className="font-medium text-xs">{formatDate(viewing.createdAt)}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">Состав заказа</p>
                <div className="space-y-2">
                  {viewing.items.map((it) => (
                    <div
                      key={it.id}
                      className="rounded-lg border p-3"
                    >
                      <div className="flex justify-between">
                        <span className="font-medium text-sm">{it.title}</span>
                        <span className="text-sm">
                          {formatPrice(it.price)} × {it.qty}
                        </span>
                      </div>
                      {it.delivered && (
                        <div className="mt-2">
                          <p className="text-xs text-emerald-600 font-medium mb-1">
                            ✓ Выдано:
                          </p>
                          <pre className="text-xs bg-zinc-50 dark:bg-zinc-900 rounded p-2 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                            {it.delivered}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2">
              {viewing.status === "pending" && (
                <>
                  <Button
                    variant="outline"
                    onClick={() => action(viewing, "cancel")}
                  >
                    <XCircle className="h-4 w-4 mr-1" /> Отменить
                  </Button>
                  <Button onClick={() => action(viewing, "pay")}>
                    <CheckCircle className="h-4 w-4 mr-1" /> Оплата получена · Выдать
                  </Button>
                </>
              )}
              {(viewing.status === "completed" || viewing.status === "paid") && (
                <Button
                  variant="outline"
                  onClick={() => action(viewing, "refund")}
                >
                  <RefreshCw className="h-4 w-4 mr-1" /> Возврат
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
