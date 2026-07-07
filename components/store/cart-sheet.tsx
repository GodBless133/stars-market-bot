"use client"

import { useState } from "react"
import { useStore } from "@/lib/store-state"
import { api } from "@/lib/api-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet"
import { ProductCover } from "@/components/product-cover"
import { formatPrice } from "@/lib/store"
import {
  Trash2,
  Plus,
  Minus,
  ShoppingBag,
  CheckCircle2,
  CreditCard,
  Star,
  Bitcoin,
  Wallet,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const PAY_METHODS = [
  { id: "card", label: "Банковская карта", icon: CreditCard },
  { id: "stars", label: "Telegram Stars", icon: Star },
  { id: "crypto", label: "Криптовалюта", icon: Bitcoin },
  { id: "balance", label: "Баланс", icon: Wallet },
]

export function CartSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const items = useStore((s) => s.items)
  const remove = useStore((s) => s.remove)
  const setQty = useStore((s) => s.setQty)
  const clear = useStore((s) => s.clear)
  const total = useStore((s) => s.total())
  const tgUser = useStore((s) => s.tgUser)

  const [step, setStep] = useState<"cart" | "checkout" | "success">("cart")
  const [name, setName] = useState("")
  const [tgId, setTgId] = useState("")
  const [payMethod, setPayMethod] = useState("card")
  const [orderNumber, setOrderNumber] = useState("")
  const [delivered, setDelivered] = useState<string | null>(null)
  const [placing, setPlacing] = useState(false)

  const placeOrder = async () => {
    if (items.length === 0) return
    setPlacing(true)
    try {
      const { order } = await api.post<{ order: any }>("/api/orders", {
        items: items.map((i) => ({ productId: i.productId, qty: i.qty })),
        customerName: name || tgUser?.firstName,
        customerTg: tgId || tgUser?.id,
        payMethod,
      })
      // simulate payment + auto-deliver
      const { order: completed } = await api.patch<{ order: any }>(`/api/orders/${order.id}`, {
        action: "pay",
      })
      setOrderNumber(completed.number)
      const allDelivered = completed.items
        ?.map((it: any) => it.delivered)
        .filter(Boolean)
        .join("\n\n---\n\n")
      setDelivered(allDelivered)
      setStep("success")
      clear()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setPlacing(false)
    }
  }

  const reset = () => {
    setStep("cart")
    setOrderNumber("")
    setDelivered(null)
    setName("")
    setTgId("")
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setTimeout(reset, 300) }}>
      <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle className="flex items-center gap-2">
            {step === "cart" && (
              <>
                <ShoppingBag className="h-5 w-5" /> Корзина
              </>
            )}
            {step === "checkout" && "Оформление заказа"}
            {step === "success" && (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-500" /> Заказ оформлен
              </>
            )}
          </SheetTitle>
        </SheetHeader>

        {step === "cart" && (
          <>
            <div className="flex-1 overflow-y-auto p-4">
              {items.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground">
                  <ShoppingBag className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p>Корзина пуста</p>
                  <p className="text-xs mt-1">Добавьте товары из каталога</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {items.map((item) => (
                    <div key={item.productId} className="flex gap-3 rounded-xl border p-2">
                      <ProductCover
                        image={item.image}
                        title={item.title}
                        className="h-16 w-16 rounded-lg flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium line-clamp-2">{item.title}</p>
                        <p className="text-sm font-bold mt-0.5">{formatPrice(item.price)}</p>
                        <div className="mt-1.5 flex items-center justify-between">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setQty(item.productId, item.qty - 1)}
                              className="flex h-6 w-6 items-center justify-center rounded-md border hover:bg-zinc-100"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-7 text-center text-sm font-medium">
                              {item.qty}
                            </span>
                            <button
                              onClick={() => setQty(item.productId, item.qty + 1)}
                              className="flex h-6 w-6 items-center justify-center rounded-md border hover:bg-zinc-100"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          <button
                            onClick={() => remove(item.productId)}
                            className="text-muted-foreground hover:text-destructive p-1"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {items.length > 0 && (
              <SheetFooter className="border-t p-4 flex-col gap-3">
                <div className="flex items-center justify-between w-full">
                  <span className="text-sm text-muted-foreground">Итого</span>
                  <span className="text-xl font-bold">{formatPrice(total)}</span>
                </div>
                <Button
                  className="w-full rounded-full bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90"
                  onClick={() => setStep("checkout")}
                >
                  Оформить заказ
                </Button>
              </SheetFooter>
            )}
          </>
        )}

        {step === "checkout" && (
          <>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="grid gap-2">
                <Label>Имя</Label>
                <Input
                  placeholder="Как к вам обращаться"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label>Telegram ID <span className="text-muted-foreground">(необязательно)</span></Label>
                <Input
                  placeholder="например 123456789"
                  value={tgId}
                  onChange={(e) => setTgId(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Для получения заказа в боте
                </p>
              </div>

              <div className="grid gap-2">
                <Label>Способ оплаты</Label>
                <div className="grid grid-cols-2 gap-2">
                  {PAY_METHODS.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => setPayMethod(m.id)}
                      className={cn(
                        "flex flex-col items-center gap-1 rounded-xl border p-3 text-xs transition-all",
                        payMethod === m.id
                          ? "border-amber-500 bg-amber-50 dark:bg-amber-950/30"
                          : "hover:border-zinc-300"
                      )}
                    >
                      <m.icon className="h-5 w-5" />
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border bg-zinc-50 dark:bg-zinc-900 p-3 text-sm space-y-1">
                {items.map((i) => (
                  <div key={i.productId} className="flex justify-between">
                    <span className="truncate pr-2 text-muted-foreground">
                      {i.title} × {i.qty}
                    </span>
                    <span>{formatPrice(i.price * i.qty)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold pt-1 border-t mt-1">
                  <span>Итого</span>
                  <span>{formatPrice(total)}</span>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                💡 В демо-режиме оплата симулируется — товар будет выдан автоматически.
              </p>
            </div>

            <SheetFooter className="border-t p-4 flex-col gap-2">
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => setStep("cart")}
              >
                Назад
              </Button>
              <Button
                className="w-full rounded-full bg-gradient-to-br from-amber-500 to-orange-600 hover:opacity-90"
                onClick={placeOrder}
                disabled={placing}
              >
                {placing ? "Обработка..." : `Оплатить ${formatPrice(total)}`}
              </Button>
            </SheetFooter>
          </>
        )}

        {step === "success" && (
          <div className="flex-1 overflow-y-auto p-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-950">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <h3 className="text-lg font-bold">Заказ выполнен!</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Номер заказа: <span className="font-mono font-medium text-foreground">{orderNumber}</span>
            </p>

            {delivered && (
              <div className="mt-4 text-left">
                <p className="text-sm font-medium text-emerald-600 mb-2">
                  🎉 Ваши товары:
                </p>
                <pre className="text-xs bg-zinc-50 dark:bg-zinc-900 rounded-lg p-3 whitespace-pre-wrap break-all max-h-72 overflow-y-auto border">
                  {delivered}
                </pre>
              </div>
            )}

            <p className="mt-4 text-xs text-muted-foreground">
              Сохраните эти данные. При необходимости поддержка поможет по ID заказа.
            </p>

            <Button
              className="w-full mt-6 rounded-full"
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                setTimeout(reset, 300)
              }}
            >
              Готово
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}
