"use client"

import { Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { XCircle, RefreshCw, MessageCircle } from "lucide-react"

function FailedContent() {
  const sp = useSearchParams()
  const order = sp.get("order") || ""

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-950 to-zinc-900 text-white flex flex-col items-center justify-center p-6 max-w-md mx-auto">
      <div className="w-full bg-zinc-900/80 backdrop-blur border border-white/10 rounded-3xl p-8 shadow-2xl">
        <div className="flex justify-center mb-6">
          <div className="h-20 w-20 rounded-full bg-red-500/20 flex items-center justify-center">
            <XCircle className="h-12 w-12 text-red-400" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-center mb-2">Оплата не прошла</h1>
        <p className="text-zinc-400 text-center text-sm mb-6">
          Платёж был отменён или не завершился. Деньги не списаны.
        </p>

        {order && (
          <div className="bg-zinc-800/50 rounded-xl p-3 mb-6 flex items-center justify-between">
            <span className="text-xs text-zinc-500">Номер заказа</span>
            <span className="font-mono text-sm text-zinc-300">{order}</span>
          </div>
        )}

        <div className="bg-zinc-800/30 rounded-xl p-4 mb-6">
          <div className="text-xs text-zinc-400 space-y-2">
            <div className="flex items-start gap-2">
              <RefreshCw className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>Попробуйте оплатить снова — выберите другой способ оплаты (СБП, карта, крипта).</span>
            </div>
            <div className="flex items-start gap-2">
              <MessageCircle className="h-4 w-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <span>Если деньги списались, но вы видите эту страницу — напишите в поддержку с номером заказа.</span>
            </div>
          </div>
        </div>

        <a
          href="https://t.me/StarsMarkeet_bot"
          className="block w-full text-center bg-gradient-to-br from-amber-500 to-orange-600 text-white font-medium py-3 rounded-full hover:opacity-90 transition mb-3"
        >
          Открыть бота
        </a>
        <a
          href="/"
          className="block w-full text-center text-zinc-400 text-sm py-2 hover:text-white"
        >
          Вернуться в магазин
        </a>
      </div>
    </div>
  )
}

export default function PaymentFailedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-zinc-950" />}>
      <FailedContent />
    </Suspense>
  )
}
