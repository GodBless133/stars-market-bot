"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { CheckCircle2, MessageCircle, Copy } from "lucide-react"
import { toast } from "sonner"

function SuccessContent() {
  const sp = useSearchParams()
  const order = sp.get("order") || ""
  const [orderInfo, setOrderInfo] = useState<{ number: string; status: string; items: { title: string; delivered: string | null }[] } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!order) {
      setLoading(false)
      return
    }
    // Fetch order details (public — no auth needed for status check)
    fetch(`/api/orders?number=${encodeURIComponent(order)}`)
      .then(r => r.json())
      .then(d => {
        if (d.order) setOrderInfo(d.order)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [order])

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 text-white flex flex-col items-center justify-center p-6 max-w-md mx-auto">
      <div className="w-full bg-zinc-900/80 backdrop-blur border border-white/10 rounded-3xl p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="h-20 w-20 rounded-full bg-green-500/20 flex items-center justify-center">
            <CheckCircle2 className="h-12 w-12 text-green-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center mb-2">Оплата получена!</h1>
        <p className="text-zinc-400 text-center text-sm mb-6">
          Спасибо за покупку. Ваш заказ успешно оплачен.
        </p>

        {order && (
          <div className="bg-zinc-800/50 rounded-xl p-3 mb-4 flex items-center justify-between">
            <span className="text-xs text-zinc-500">Номер заказа</span>
            <button
              className="font-mono text-sm text-amber-400 flex items-center gap-1 hover:text-amber-300"
              onClick={() => { navigator.clipboard.writeText(order); toast.success("Скопировано") }}
            >
              {order}
              <Copy className="h-3 w-3" />
            </button>
          </div>
        )}

        {loading ? (
          <div className="text-center text-zinc-500 text-sm py-4">Загрузка деталей заказа…</div>
        ) : orderInfo ? (
          <div className="space-y-3 mb-6">
            <div className="text-xs text-zinc-500 uppercase tracking-wide">Статус</div>
            <div className="text-sm">
              {orderInfo.status === "completed" && <span className="text-green-400">✅ Выполнен</span>}
              {orderInfo.status === "paid" && <span className="text-blue-400">🟦 Оплачен — выдаём товар</span>}
              {orderInfo.status === "pending" && <span className="text-amber-400">⏳ Обрабатывается…</span>}
              {orderInfo.status === "cancelled" && <span className="text-red-400">❌ Отменён</span>}
            </div>

            {orderInfo.items?.length > 0 && (
              <>
                <div className="text-xs text-zinc-500 uppercase tracking-wide pt-2">Товары</div>
                {orderInfo.items.map((it, i) => (
                  <div key={i} className="bg-zinc-800/50 rounded-lg p-3">
                    <div className="text-sm font-medium">{it.title}</div>
                    {it.delivered && !it.delivered.startsWith("⚠️") && !it.delivered.startsWith("🚀") && !it.delivered.startsWith("📱") && (
                      <pre className="mt-2 text-xs bg-zinc-950/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">{it.delivered}</pre>
                    )}
                    {(it.delivered?.startsWith("🚀") || it.delivered?.startsWith("📱")) && (
                      <div className="mt-2 text-xs text-amber-400">{it.delivered}</div>
                    )}
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <div className="text-center text-zinc-500 text-sm py-4">
            Заказ скоро будет обработан. Проверьте чат с ботом.
          </div>
        )}

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
          <div className="flex items-start gap-2">
            <MessageCircle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-zinc-300">
              <div className="font-medium text-amber-400 mb-1">Что дальше?</div>
              Откройте чат с нашим ботом в Telegram — туда придёт подтверждение и код/товар.
              Для накрутки — пришлите ссылку на пост в чат с ботом.
            </div>
          </div>
        </div>

        <a
          href="https://t.me/StarsMarkeet_bot"
          className="block w-full text-center bg-gradient-to-br from-amber-500 to-orange-600 text-white font-medium py-3 rounded-full hover:opacity-90 transition"
        >
          Открыть бота в Telegram
        </a>
      </div>
    </div>
  )
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <SuccessContent />
    </Suspense>
  )
}
