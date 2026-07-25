"use client"

import { useState, useEffect } from "react"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { Trash2, Plus, Gift, TrendingUp, ShoppingCart, Percent, User } from "lucide-react"

interface Promo {
  id: string
  code: string
  type: string
  value: number
  maxUses: number
  usesCount: number
  revenue: number
  revenueOrders: number
  active: boolean
  assignedToTgId: string | null
  note: string | null
  remaining: number
}

export function AdminPromos() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [totals, setTotals] = useState({ revenue: 0, orders: 0, uses: 0, count: 0 })
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ code: "", type: "discount", value: 10, maxUses: 100, assignedToTgId: "", note: "" })

  const load = async () => {
    setLoading(true)
    try {
      const d = await api.get<{ promos: Promo[]; totals: typeof totals }>("/api/admin/promos")
      setPromos(d.promos || [])
      setTotals(d.totals || { revenue: 0, orders: 0, uses: 0, count: 0 })
    } catch (e: any) {
      toast.error(e?.message || "Ошибка загрузки")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const create = async () => {
    try {
      await api.post("/api/admin/promos", {
        code: form.code,
        type: form.type,
        value: Number(form.value),
        maxUses: Number(form.maxUses),
        assignedToTgId: form.assignedToTgId || undefined,
        note: form.note || undefined,
      })
      toast.success("Промокод создан!")
      setForm({ code: "", type: "discount", value: 10, maxUses: 100, assignedToTgId: "", note: "" })
      setShowForm(false)
      load()
    } catch (e: any) {
      toast.error(e?.message || "Ошибка создания")
    }
  }

  const toggle = async (id: string, active: boolean) => {
    try {
      await api.patch("/api/admin/promos", { id, active: !active })
      load()
      toast.success(active ? "Деактивирован" : "Активирован")
    } catch { toast.error("Ошибка") }
  }

  const remove = async (id: string) => {
    if (!confirm("Удалить промокод?")) return
    try {
      await api.delete(`/api/admin/promos?id=${id}`)
      load()
      toast.success("Удалён")
    } catch { toast.error("Ошибка") }
  }

  const typeLabel = (t: string, v: number) => {
    if (t === "discount") return `${v}%`
    if (t === "fixed") return `${v}₽`
    return `${v}⭐`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Промокоды</h2>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Создать
        </Button>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-green-500/10 flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-green-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Доход</p>
              <p className="text-lg font-bold">{totals.revenue}₽</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <ShoppingCart className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Заказов</p>
              <p className="text-lg font-bold">{totals.orders}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Gift className="h-5 w-5 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Использований</p>
              <p className="text-lg font-bold">{totals.uses}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-purple-500/10 flex items-center justify-center">
              <Percent className="h-5 w-5 text-purple-500" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Промокодов</p>
              <p className="text-lg font-bold">{totals.count}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Create form */}
      {showForm && (
        <Card>
          <CardHeader><CardTitle className="text-base">Новый промокод</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Код</label>
                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="WELCOME10" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Тип</label>
                <select className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="discount">Скидка %</option>
                  <option value="fixed">Фикс. ₽</option>
                  <option value="stars">Бонус ⭐</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Значение</label>
                <Input type="number" value={form.value} onChange={(e) => setForm({ ...form, value: Number(e.target.value) })} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Лимит</label>
                <Input type="number" value={form.maxUses} onChange={(e) => setForm({ ...form, maxUses: Number(e.target.value) })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Персональный для tgId (необязательно)</label>
                <Input value={form.assignedToTgId} onChange={(e) => setForm({ ...form, assignedToTgId: e.target.value })} placeholder="7264716736" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Заметка</label>
                <Input value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Для канала X" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={create} size="sm">Создать</Button>
              <Button variant="outline" onClick={() => setShowForm(false)} size="sm">Отмена</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Promo list */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-muted-foreground">Загрузка...</div>
          ) : promos.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">Промокодов пока нет</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3">Код</th>
                    <th className="p-3">Тип</th>
                    <th className="p-3 text-center">Исп.</th>
                    <th className="p-3 text-center">Заказов</th>
                    <th className="p-3 text-right">Доход</th>
                    <th className="p-3 text-center">Статус</th>
                    <th className="p-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {promos.map((p) => (
                    <tr key={p.id} className="border-b hover:bg-zinc-50 dark:hover:bg-zinc-900">
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold">{p.code}</span>
                          {p.assignedToTgId && (
                            <Badge variant="secondary" className="text-xs">
                              <User className="h-3 w-3 mr-1" /> {p.assignedToTgId.slice(-4)}
                            </Badge>
                          )}
                        </div>
                        {p.note && <span className="text-xs text-muted-foreground">{p.note}</span>}
                      </td>
                      <td className="p-3">{typeLabel(p.type, p.value)}</td>
                      <td className="p-3 text-center">{p.usesCount}/{p.maxUses}</td>
                      <td className="p-3 text-center">{p.revenueOrders}</td>
                      <td className="p-3 text-right font-bold text-green-600">{p.revenue}₽</td>
                      <td className="p-3 text-center">
                        <button
                          onClick={() => toggle(p.id, p.active)}
                          className={`text-xs px-2 py-1 rounded ${p.active ? "bg-green-500/10 text-green-600" : "bg-zinc-500/10 text-zinc-500"}`}
                        >
                          {p.active ? "✓ Активен" : "✕ Выкл"}
                        </button>
                      </td>
                      <td className="p-3">
                        <button onClick={() => remove(p.id)} className="text-red-500 hover:text-red-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
