"use client"

import { useEffect, useState } from "react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { toast } from "sonner"
import { formatPrice, formatDate } from "@/lib/store"
import { Users, Ban, ShieldCheck } from "lucide-react"

interface Customer {
  id: string
  tgId: string | null
  username: string | null
  firstName: string | null
  lastName: string | null
  phone: string | null
  balance: number
  totalSpent: number
  ordersCount: number
  banned: boolean
  createdAt: string
  _count: { orders: number; reviews: number }
}

export function AdminCustomers() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    setLoading(true)
    api
      .get<{ customers: Customer[] }>("/api/admin/customers")
      .then((d) => setCustomers(d.customers))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const toggleBan = async (c: Customer) => {
    await api.patch(`/api/admin/customers/${c.id}`, { banned: !c.banned })
    toast.success(c.banned ? "Клиент разбанен" : "Клиент забанен")
    load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Клиенты</h1>
        <p className="text-sm text-muted-foreground">
          Всего клиентов: {customers.length}
        </p>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : customers.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Users className="h-10 w-10 mx-auto mb-2 opacity-40" />
          Клиентов нет
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {customers.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border bg-white dark:bg-zinc-900 p-4"
            >
              <div className="flex items-start gap-3">
                <Avatar className="h-10 w-10">
                  <AvatarFallback className="bg-gradient-to-br from-sky-400 to-indigo-600 text-white">
                    {(c.firstName || c.username || "?").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="font-medium truncate">
                      {c.firstName || c.username || "Без имени"}
                    </p>
                    {c.banned && <Badge variant="destructive">Ban</Badge>}
                  </div>
                  {c.username && (
                    <p className="text-xs text-muted-foreground">@{c.username}</p>
                  )}
                  {c.tgId && (
                    <p className="text-xs text-muted-foreground">ID: {c.tgId}</p>
                  )}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-2">
                  <p className="text-xs text-muted-foreground">Заказов</p>
                  <p className="font-semibold">{c.ordersCount}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-2">
                  <p className="text-xs text-muted-foreground">Отзывов</p>
                  <p className="font-semibold">{c._count.reviews}</p>
                </div>
                <div className="rounded-lg bg-zinc-50 dark:bg-zinc-800 p-2">
                  <p className="text-xs text-muted-foreground">Потратил</p>
                  <p className="font-semibold text-sm">{formatPrice(c.totalSpent)}</p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {formatDate(c.createdAt)}
                </span>
                <Button
                  variant={c.banned ? "outline" : "ghost"}
                  size="sm"
                  onClick={() => toggleBan(c)}
                  className={c.banned ? "" : "text-destructive"}
                >
                  {c.banned ? (
                    <>
                      <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Разбанить
                    </>
                  ) : (
                    <>
                      <Ban className="h-3.5 w-3.5 mr-1" /> Забанить
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
